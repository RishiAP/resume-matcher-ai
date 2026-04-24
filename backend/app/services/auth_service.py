from __future__ import annotations

import hashlib
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional

from jose import JWTError, jwt
from passlib.context import CryptContext
from sqlalchemy.orm import Session

from app.config import get_settings
from app.models import RefreshToken, User

settings = get_settings()

# Prefer Argon2 for new hashes, fall back to bcrypt_sha256 and bcrypt for
# compatibility with older hashes. Requires `argon2-cffi` installed.
pwd_context = CryptContext(schemes=["argon2", "bcrypt_sha256", "bcrypt"], deprecated="auto")
ALGORITHM = "HS256"


def get_password_hash(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain_password: str, hashed_password: str) -> bool:
    try:
        return pwd_context.verify(plain_password, hashed_password)
    except Exception:
        return False


def create_access_token(subject: str, expires_delta: Optional[timedelta] = None) -> str:
    to_encode = {"sub": str(subject)}
    now = datetime.now(timezone.utc)
    if expires_delta is None:
        expires_delta = timedelta(minutes=settings.access_token_expire_minutes)
    expire = now + expires_delta
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, settings.secret_key, algorithm=ALGORITHM)
    return encoded_jwt


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _ensure_utc(dt: datetime) -> datetime:
    """Return a timezone-aware UTC datetime for comparison.

    If `dt` is naive, assume it's in UTC and attach UTC tzinfo. Otherwise
    convert to UTC.
    """
    if dt is None:
        return dt
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def create_refresh_token(db: Session, user_id: int) -> str:
    token = secrets.token_urlsafe(48)
    token_hash = _hash_token(token)
    expires_at = datetime.now(timezone.utc) + timedelta(days=settings.refresh_token_expire_days)

    rt = RefreshToken(
        user_id=user_id,
        token_hash=token_hash,
        expires_at=expires_at,
    )
    db.add(rt)
    db.commit()
    db.refresh(rt)
    return token


def verify_refresh_token(db: Session, token: str) -> Optional[RefreshToken]:
    token_hash = _hash_token(token)
    now = datetime.now(timezone.utc)
    q = db.query(RefreshToken).filter(RefreshToken.token_hash == token_hash)
    rt = q.first()
    if rt is None:
        return None

    expires_at = _ensure_utc(rt.expires_at)
    if expires_at < now:
        return None
    return rt


def revoke_refresh_token(db: Session, rt: RefreshToken) -> None:
    try:
        db.delete(rt)
        db.commit()
    except Exception:
        db.rollback()


def get_user_by_email(db: Session, email: str) -> Optional[User]:
    return db.query(User).filter(User.email == email).first()


def get_user_by_username(db: Session, username: str) -> Optional[User]:
    return db.query(User).filter(User.username == username).first()


def get_user_by_identifier(db: Session, identifier: str) -> Optional[User]:
    # Attempt to find by email or username
    q = db.query(User).filter((User.email == identifier) | (User.username == identifier))
    return q.first()


def get_user_by_id(db: Session, user_id: int) -> Optional[User]:
    return db.query(User).filter(User.id == int(user_id)).first()


def create_user(db: Session, username: str, email: str, password: str) -> User:
    hashed = get_password_hash(password)
    user = User(username=username, email=email, hashed_password=hashed, is_active=True)
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def authenticate_user(db: Session, identifier: str, password: str) -> Optional[User]:
    user = get_user_by_identifier(db, identifier)
    if not user:
        return None
    if not verify_password(password, user.hashed_password):
        return None

    # If the stored hash uses an older/weak scheme, transparently upgrade it
    # on successful authentication so future logins use Argon2.
    try:
        if pwd_context.needs_update(user.hashed_password):
            user.hashed_password = get_password_hash(password)
            db.add(user)
            db.commit()
            db.refresh(user)
    except Exception:
        # Ignore rehash failures; authentication already succeeded.
        pass

    return user


def decode_access_token(token: str) -> dict:
    try:
        payload = jwt.decode(token, settings.secret_key, algorithms=[ALGORITHM])
        return payload
    except JWTError as exc:
        raise
