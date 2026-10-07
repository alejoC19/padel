'use client';

import { useEffect } from 'react';
import { playerAuth } from '@/lib/playerAuth';

/**
 * Dispara el refresh silencioso de la cuenta del jugador al montar cualquier
 * pantalla del portal (`/jugador` o `/c/[slug]`) — sin esto, un F5 deja el
 * access token en null hasta que algo dispare un 401 y lo note.
 */
export function PlayerSessionBoot() {
  useEffect(() => { void playerAuth.restoreSession(); }, []);
  return null;
}
