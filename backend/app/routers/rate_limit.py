from fastapi import APIRouter, HTTPException
from app.services.token_tracker import adaptive_rate_limiter

router = APIRouter()


@router.get("/usage")
async def get_rate_limit_usage():
    """Get current rate limit usage statistics."""
    try:
        usage = adaptive_rate_limiter.get_current_usage()
        limits = usage['limits']
        
        percentages = {}
        if limits['requests_per_minute'] > 0:
            percentages['requests_minute'] = f"{(usage['requests_minute'] / limits['requests_per_minute']) * 100:.1f}%"
        if limits['requests_per_day'] > 0:
            percentages['requests_day'] = f"{(usage['requests_day'] / limits['requests_per_day']) * 100:.1f}%"
        if limits['tokens_per_minute'] > 0:
            percentages['tokens_minute'] = f"{(usage['tokens_minute'] / limits['tokens_per_minute']) * 100:.1f}%"
        if limits['tokens_per_day'] > 0:
            percentages['tokens_day'] = f"{(usage['tokens_day'] / limits['tokens_per_day']) * 100:.1f}%"
        
        recommended_delay = adaptive_rate_limiter.get_recommended_delay()
        
        return {
            "usage": usage,
            "percentages": percentages,
            "recommended_delay_seconds": round(recommended_delay, 2),
            "safety_margin": f"{adaptive_rate_limiter.safety_margin * 100:.0f}%"
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get rate limit usage: {str(e)}")


@router.post("/reset-test")
async def reset_test_counters():
    """Reset test counters (for development only)."""
    try:
        # This would reset Redis keys - in production, you'd want authentication
        # For now, just return current usage
        usage = token_tracker.get_usage()
        return {
            "message": "In production, this would reset counters. Current usage:",
            "usage": usage
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to reset counters: {str(e)}")