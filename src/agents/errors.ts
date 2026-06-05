/** Codigos de guarda dos especialistas (PRD §6: retornos de erro). */
export type GuardCode = 'platform_not_supported' | 'wrong_format' | 'too_long';

/**
 * Lancado quando um especialista e acionado fora da sua plataforma/formato.
 * Implementa, em CODIGO (deterministico), o "Nunca roda fora de IG / Nunca em
 * video / Nunca em duration>90" do PRD — sem depender do LLM devolver um erro.
 */
export class AgentGuardError extends Error {
  constructor(public readonly code: GuardCode, message?: string) {
    super(message ?? code);
    this.name = 'AgentGuardError';
  }
}
