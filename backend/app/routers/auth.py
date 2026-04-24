from __future__ import annotations

from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Response, Request, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import get_db
from app.schemas import UserCreate, UserRead, LoginRequest, TokenResponse
from app.services import auth_service

settings = get_settings()
router = APIRouter()
security = HTTPBearer()


def _set_refresh_cookie(response: Response, token: str) -> None:
    max_age = settings.refresh_token_expire_days * 24 * 3600
    response.set_cookie(
        settings.refresh_token_cookie_name,
        token,
        httponly=True,
        secure=settings.refresh_token_cookie_secure,
        samesite=settings.refresh_token_cookie_samesite,
        max_age=max_age,
        path="/",
    )


# @router.post("/register", response_model=UserRead, status_code=status.HTTP_201_CREATED)
# def register(payload: UserCreate, db: Session = Depends(get_db)) -> UserRead:
#     if auth_service.get_user_by_email(db, payload.email):
#         raise HTTPException(status_code=400, detail="Email already registered")
#     if auth_service.get_user_by_username(db, payload.username):
#         raise HTTPException(status_code=400, detail="Username already taken")

#     user = auth_service.create_user(db, payload.username, payload.email, payload.password)
#     return UserRead(id=user.id, username=user.username, email=user.email, is_active=user.is_active)


@router.post("/login", response_model=TokenResponse)
def login(payload: LoginRequest, response: Response, db: Session = Depends(get_db)) -> TokenResponse:
    user = auth_service.authenticate_user(db, payload.identifier, payload.password)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid credentials")

    access_token = auth_service.create_access_token(subject=str(user.id))
    refresh_token = auth_service.create_refresh_token(db, user.id)
    _set_refresh_cookie(response, refresh_token)

    return TokenResponse(access_token=access_token, token_type="bearer")


@router.post("/refresh", response_model=TokenResponse)
def refresh(request: Request, response: Response, db: Session = Depends(get_db)) -> TokenResponse:
    token = request.cookies.get(settings.refresh_token_cookie_name)
    if not token:
        raise HTTPException(status_code=401, detail="Missing refresh token")

    rt = auth_service.verify_refresh_token(db, token)
    if not rt:
        raise HTTPException(status_code=401, detail="Invalid or expired refresh token")

    # rotate: remove old token and issue a new one
    auth_service.revoke_refresh_token(db, rt)
    new_refresh = auth_service.create_refresh_token(db, rt.user_id)
    _set_refresh_cookie(response, new_refresh)

    access_token = auth_service.create_access_token(subject=str(rt.user_id))
    return TokenResponse(access_token=access_token, token_type="bearer")


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(request: Request, response: Response, db: Session = Depends(get_db)):
    token = request.cookies.get(settings.refresh_token_cookie_name)
    if token:
        rt = auth_service.verify_refresh_token(db, token)
        if rt:
            auth_service.revoke_refresh_token(db, rt)

    # clear cookie
    response.delete_cookie(settings.refresh_token_cookie_name, path="/")
    return Response(status_code=status.HTTP_204_NO_CONTENT)


def _unauthorized() -> HTTPException:
    return HTTPException(status_code=401, detail="Unauthorized")




@router.get("/verify", response_model=UserRead)
def verify(request: Request, db: Session = Depends(get_db)) -> UserRead:
    token = request.cookies.get(settings.refresh_token_cookie_name)
    if not token:
        raise HTTPException(status_code=401, detail="Missing refresh token")

    rt = auth_service.verify_refresh_token(db, token)
    if not rt:
        raise HTTPException(status_code=401, detail="Invalid or expired refresh token")

    user = auth_service.get_user_by_id(db, int(rt.user_id))
    if not user:
        raise HTTPException(status_code=401, detail="User not found")

    return UserRead(id=user.id, username=user.username, email=user.email, is_active=user.is_active)


def get_current_user(request: Request, db: Session = Depends(get_db)) -> UserRead:
    # Try Authorization: Bearer <token>
    auth_header = request.headers.get("authorization")
    if auth_header:
        parts = auth_header.split()
        if len(parts) == 2 and parts[0].lower() == "bearer":
            token = parts[1]
            try:
                payload = auth_service.decode_access_token(token)
                user_id = payload.get("sub")
                if user_id:
                    user = auth_service.get_user_by_id(db, int(user_id))
                    if user:
                        return UserRead(id=user.id, username=user.username, email=user.email, is_active=user.is_active)
            except Exception:
                pass

    # Fallback: check refresh token cookie
    token = request.cookies.get(settings.refresh_token_cookie_name)
    if token:
        rt = auth_service.verify_refresh_token(db, token)
        if rt:
            user = auth_service.get_user_by_id(db, int(rt.user_id))
            if user:
                return UserRead(id=user.id, username=user.username, email=user.email, is_active=user.is_active)

    raise _unauthorized()


@router.get("/me", response_model=UserRead)
def me(user: UserRead = Depends(get_current_user)) -> UserRead:
    return user
