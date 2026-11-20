import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { onAuthStateChanged, signInWithPopup, signOut } from 'firebase/auth';
import { auth, googleAuthProvider } from '../lib/firebase';
import type { KilnUser } from '../types/kiln';

interface RegisterPayload {
  fullName: string;
  email: string;
  phoneNumber?: string;
  password: string;
  communityArea: string;
  termsAccepted: boolean;
}

interface ProfileUpdatePayload {
  fullName: string;
  phoneNumber?: string;
  communityArea: string;
  address?: string;
  lightningAddress?: string;
}

interface AuthContextValue {
  user: KilnUser | null;
  loading: boolean;
  authProvider: 'session' | 'firebase' | null;
  loginWithEmail: (email: string, password: string) => Promise<KilnUser>;
  registerWithEmail: (payload: RegisterPayload) => Promise<KilnUser>;
  loginWithGoogle: () => Promise<KilnUser>;
  logout: () => Promise<void>;
  updateProfile: (payload: ProfileUpdatePayload) => Promise<KilnUser>;
  refreshUser: () => Promise<void>;
  authFetch: (input: string, init?: RequestInit) => Promise<Response>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<KilnUser | null>(null);
  const [authProvider, setAuthProvider] = useState<'session' | 'firebase' | null>(null);
  const [loading, setLoading] = useState(true);
  const firebaseTokenRef = useRef<string | null>(null);

  const authFetch = useCallback(async (input: string, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    if (firebaseTokenRef.current) {
      headers.set('Authorization', `Bearer ${firebaseTokenRef.current}`);
    }
    return fetch(input, {
      ...init,
      headers,
      credentials: 'include',
    });
  }, []);

  const fetchCurrentSession = useCallback(async (bearerToken?: string | null) => {
    const headers: Record<string, string> = {};
    if (bearerToken) {
      headers.Authorization = `Bearer ${bearerToken}`;
    }

    const res = await fetch('/api/auth/me', {
      headers,
      credentials: 'include',
    });

    if (!res.ok) {
      setUser(null);
      setAuthProvider(null);
      return null;
    }

    const data = await res.json();
    if (data.authenticated && data.user) {
      setUser(data.user);
      setAuthProvider(data.provider ?? 'session');
      return data.user as KilnUser;
    }

    setUser(null);
    setAuthProvider(null);
    return null;
  }, []);

  useEffect(() => {
    let active = true;

    const unsubscribe = onAuthStateChanged(auth, async (fbUser) => {
      try {
        if (fbUser) {
          const idToken = await fbUser.getIdToken();
          firebaseTokenRef.current = idToken;
          if (active) {
            await fetchCurrentSession(idToken);
          }
        } else {
          firebaseTokenRef.current = null;
          if (active) {
            await fetchCurrentSession(null);
          }
        }
      } catch (err) {
        console.error('Auth initialization warning:', err);
        if (active) {
          setUser(null);
          setAuthProvider(null);
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, [fetchCurrentSession]);

  const loginWithEmail = useCallback(async (email: string, password: string) => {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Could not sign in with those credentials.');
    }
    firebaseTokenRef.current = null;
    setUser(data.user);
    setAuthProvider('session');
    return data.user as KilnUser;
  }, []);

  const registerWithEmail = useCallback(async (payload: RegisterPayload) => {
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Could not complete registration.');
    }
    firebaseTokenRef.current = null;
    setUser(data.user);
    setAuthProvider('session');
    return data.user as KilnUser;
  }, []);

  const loginWithGoogle = useCallback(async () => {
    const result = await signInWithPopup(auth, googleAuthProvider);
    const idToken = await result.user.getIdToken();
    firebaseTokenRef.current = idToken;
    const syncedUser = await fetchCurrentSession(idToken);
    if (!syncedUser) {
      throw new Error('Google sign-in succeeded, but your KILN account could not be loaded.');
    }
    return syncedUser;
  }, [fetchCurrentSession]);

  const logout = useCallback(async () => {
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include',
      });
    } finally {
      if (auth.currentUser) {
        await signOut(auth);
      }
      firebaseTokenRef.current = null;
      setUser(null);
      setAuthProvider(null);
    }
  }, []);

  const updateProfile = useCallback(
    async (payload: ProfileUpdatePayload) => {
      const res = await authFetch('/api/account/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Could not update your profile.');
      }
      setUser(data.user);
      return data.user as KilnUser;
    },
    [authFetch]
  );

  const refreshUser = useCallback(async () => {
    await fetchCurrentSession(firebaseTokenRef.current);
  }, [fetchCurrentSession]);

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        authProvider,
        loginWithEmail,
        registerWithEmail,
        loginWithGoogle,
        logout,
        updateProfile,
        refreshUser,
        authFetch,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used inside an AuthProvider.');
  }
  return ctx;
}
