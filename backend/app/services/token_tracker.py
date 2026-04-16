import time
import redis
import math
from typing import Optional, Tuple, Dict
from datetime import datetime, timedelta
from app.config import get_settings

settings = get_settings()


class AdaptiveRateLimiter:
    """Adaptive rate limiter that monitors usage and calculates optimal wait times."""
    
    def __init__(self):
        self.redis_client = redis.Redis.from_url(settings.celery_broker_url)
        
        # Grok API free tier limits
        self.limits = {
            'requests_per_minute': settings.request_limit_per_minute,  # 3
            'requests_per_day': settings.request_limit_per_day,        # 100
            'tokens_per_minute': settings.token_limit_per_minute,      # 10,000
            'tokens_per_day': settings.token_limit_per_day,            # 100,000
        }
        
        # Safety margins (use 80% of limits to stay safe)
        self.safety_margin = 0.8
        
        # Track request history for adaptive timing
        self.request_history_key = "rate_limit:request_history"
        self.token_history_key = "rate_limit:token_history"
        
        # Initialize history if not exists
        self._init_history()
    
    def _init_history(self):
        """Initialize request history in Redis."""
        # Just ensure keys exist with proper expiry
        # They will be created when first data is pushed
        pass
    
    def _get_window_key(self, prefix: str, window_seconds: int) -> str:
        """Generate key for time window."""
        now = int(time.time())
        window_start = (now // window_seconds) * window_seconds
        return f"rate_limit:{prefix}:{window_seconds}:{window_start}"
    
    def _clean_old_history(self, history_key: str, max_age_seconds: int):
        """Remove old entries from history."""
        cutoff = time.time() - max_age_seconds
        items = self.redis_client.lrange(history_key, 0, -1)
        
        # Parse and filter
        valid_items = []
        for item in items:
            try:
                if history_key == self.request_history_key:
                    timestamp = float(item.decode())
                    if timestamp >= cutoff:
                        valid_items.append(item)
                else:  # token_history_key
                    parts = item.decode().split(':')
                    if len(parts) == 2:
                        timestamp = float(parts[0])
                        if timestamp >= cutoff:
                            valid_items.append(item)
            except:
                continue
        
        # Replace list
        self.redis_client.delete(history_key)
        if valid_items:
            self.redis_client.rpush(history_key, *valid_items)
    
    def record_request(self, estimated_tokens: int):
        """Record a request and its token usage."""
        now = time.time()
        
        # Record request timestamp
        self.redis_client.rpush(self.request_history_key, str(now))
        
        # Record token usage
        self.redis_client.rpush(self.token_history_key, f"{now}:{estimated_tokens}")
        
        # Set expiry on first write
        if self.redis_client.ttl(self.request_history_key) == -1:
            self.redis_client.expire(self.request_history_key, 86400)
        if self.redis_client.ttl(self.token_history_key) == -1:
            self.redis_client.expire(self.token_history_key, 86400)
        
        # Clean old entries (keep 24 hours)
        self._clean_old_history(self.request_history_key, 86400)
        self._clean_old_history(self.token_history_key, 86400)
        
        # Update window counters
        minute_key = self._get_window_key('requests', 60)
        day_key = self._get_window_key('requests', 86400)
        
        self.redis_client.incr(minute_key)
        self.redis_client.incr(day_key)
        
        if self.redis_client.ttl(minute_key) == -1:
            self.redis_client.expire(minute_key, 120)  # 2 minutes
        if self.redis_client.ttl(day_key) == -1:
            self.redis_client.expire(day_key, 90000)  # 25 hours
        
        # Update token counters
        token_minute_key = self._get_window_key('tokens', 60)
        token_day_key = self._get_window_key('tokens', 86400)
        
        self.redis_client.incrby(token_minute_key, estimated_tokens)
        self.redis_client.incrby(token_day_key, estimated_tokens)
        
        if self.redis_client.ttl(token_minute_key) == -1:
            self.redis_client.expire(token_minute_key, 120)
        if self.redis_client.ttl(token_day_key) == -1:
            self.redis_client.expire(token_day_key, 90000)
    
    def get_current_usage(self) -> Dict:
        """Get current usage statistics."""
        minute_key = self._get_window_key('requests', 60)
        day_key = self._get_window_key('requests', 86400)
        token_minute_key = self._get_window_key('tokens', 60)
        token_day_key = self._get_window_key('tokens', 86400)
        
        return {
            'requests_minute': int(self.redis_client.get(minute_key) or 0),
            'requests_day': int(self.redis_client.get(day_key) or 0),
            'tokens_minute': int(self.redis_client.get(token_minute_key) or 0),
            'tokens_day': int(self.redis_client.get(token_day_key) or 0),
            'limits': self.limits
        }
    
    def calculate_wait_time(self, estimated_tokens: int) -> Tuple[bool, Optional[float]]:
        """
        Calculate if we should wait and for how long.
        Returns (should_proceed, wait_seconds)
        """
        usage = self.get_current_usage()
        
        # Check if we would exceed limits
        would_exceed = False
        limiting_factor = None
        wait_seconds = None
        
        # Check minute limits with safety margin
        safe_requests_minute = self.limits['requests_per_minute'] * self.safety_margin
        safe_tokens_minute = self.limits['tokens_per_minute'] * self.safety_margin
        
        if usage['requests_minute'] + 1 > safe_requests_minute:
            would_exceed = True
            limiting_factor = 'requests_per_minute'
        elif usage['tokens_minute'] + estimated_tokens > safe_tokens_minute:
            would_exceed = True
            limiting_factor = 'tokens_per_minute'
        
        # Check day limits
        safe_requests_day = self.limits['requests_per_day'] * self.safety_margin
        safe_tokens_day = self.limits['tokens_per_day'] * self.safety_margin
        
        if usage['requests_day'] + 1 > safe_requests_day:
            would_exceed = True
            limiting_factor = 'requests_per_day'
        elif usage['tokens_day'] + estimated_tokens > safe_tokens_day:
            would_exceed = True
            limiting_factor = 'tokens_per_day'
        
        if not would_exceed:
            return True, None
        
        # Calculate optimal wait time based on limiting factor
        if limiting_factor == 'requests_per_minute':
            # We're hitting request/minute limit
            # Calculate time until we have capacity for another request
            requests_used = usage['requests_minute']
            requests_allowed = safe_requests_minute
            time_window = 60  # seconds
            
            # If we've used all requests, wait for next minute
            if requests_used >= requests_allowed:
                now = datetime.now()
                next_minute = (now + timedelta(minutes=1)).replace(second=0, microsecond=0)
                wait_seconds = (next_minute - now).total_seconds()
            else:
                # Calculate when we can make another request based on rate
                time_per_request = time_window / requests_allowed
                wait_seconds = time_per_request
        
        elif limiting_factor == 'tokens_per_minute':
            # We're hitting token/minute limit
            tokens_used = usage['tokens_minute']
            tokens_allowed = safe_tokens_minute
            time_window = 60
            
            if tokens_used + estimated_tokens > tokens_allowed:
                # Calculate when tokens will be available
                token_rate = tokens_allowed / time_window  # tokens per second
                tokens_needed = estimated_tokens
                tokens_available = tokens_allowed - tokens_used
                
                if tokens_available <= 0:
                    # Wait for next minute
                    now = datetime.now()
                    next_minute = (now + timedelta(minutes=1)).replace(second=0, microsecond=0)
                    wait_seconds = (next_minute - now).total_seconds()
                else:
                    # Calculate time to accumulate needed tokens
                    tokens_to_wait_for = tokens_needed - tokens_available
                    wait_seconds = tokens_to_wait_for / token_rate
        
        elif limiting_factor in ['requests_per_day', 'tokens_per_day']:
            # Hit daily limit - wait until next day
            now = datetime.now()
            tomorrow = (now + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
            wait_seconds = (tomorrow - now).total_seconds()
        
        # Add jitter to prevent thundering herd
        if wait_seconds:
            jitter = wait_seconds * 0.1  # 10% jitter
            wait_seconds += (time.time() % jitter)
            wait_seconds = max(1, math.ceil(wait_seconds))
        
        return False, wait_seconds
    
    def estimate_tokens(self, text: str) -> int:
        """Estimate token count for a text string."""
        # Conservative estimate: 1 token ≈ 4 characters for English text
        return max(1, len(text) // 4)
    
    def check_and_record(self, estimated_tokens: int) -> Tuple[bool, Optional[float]]:
        """
        Main method: check if we can proceed, record if we do.
        Returns (proceed, wait_seconds)
        """
        # First check if we should wait
        proceed, wait_seconds = self.calculate_wait_time(estimated_tokens)
        
        if proceed:
            # Record the request
            self.record_request(estimated_tokens)
            return True, None
        else:
            return False, wait_seconds
    
    def get_recommended_delay(self) -> float:
        """
        Get recommended delay between requests based on current usage pattern.
        Returns delay in seconds.
        """
        usage = self.get_current_usage()
        
        # Base delay on how close we are to limits
        request_utilization = usage['requests_minute'] / (self.limits['requests_per_minute'] * self.safety_margin)
        token_utilization = usage['tokens_minute'] / (self.limits['tokens_per_minute'] * self.safety_margin)
        
        utilization = max(request_utilization, token_utilization)
        
        if utilization < 0.3:  # Low usage
            base_delay = 1.0
        elif utilization < 0.6:  # Medium usage
            base_delay = 5.0
        elif utilization < 0.8:  # High usage
            base_delay = 10.0
        else:  # Very high usage
            base_delay = 20.0
        
        # Add adaptive component based on recent request rate
        recent_requests = self._get_recent_requests(300)  # Last 5 minutes
        if len(recent_requests) > 1:
            intervals = []
            for i in range(1, len(recent_requests)):
                intervals.append(recent_requests[i] - recent_requests[i-1])
            
            if intervals:
                avg_interval = sum(intervals) / len(intervals)
                # If requests are coming faster than average, increase delay
                if avg_interval < base_delay:
                    base_delay = avg_interval * 1.5
        
        return max(1.0, base_delay)
    
    def _get_recent_requests(self, time_window: int) -> list:
        """Get timestamps of recent requests."""
        cutoff = time.time() - time_window
        items = self.redis_client.lrange(self.request_history_key, 0, -1)
        
        timestamps = []
        for item in items:
            try:
                timestamp = float(item.decode())
                if timestamp >= cutoff:
                    timestamps.append(timestamp)
            except:
                continue
        
        return sorted(timestamps)


# Global instance
adaptive_rate_limiter = AdaptiveRateLimiter()