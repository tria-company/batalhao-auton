import { z } from 'zod';
import {
  nivelTecnicoEnum,
  perfilAlvoEnum,
  temaPrincipalEnum,
  tipoEnum,
  tomEnum,
  tresNiveisEnum,
} from './common';

/** Saida do Agente 1 · ORGANIZADOR — 9 campos universais (PRD §6). */
export const organizadorOutputSchema = z.object({
  tipo: tipoEnum,
  tema_principal: temaPrincipalEnum,
  temas_secundarios: z.array(temaPrincipalEnum).max(3),
  perfil_alvo: perfilAlvoEnum,
  nivel_tecnico: nivelTecnicoEnum,
  tom: tomEnum,
  tem_prova: z.boolean(),
  tem_cta: z.boolean(),
  qualidade_legenda: tresNiveisEnum,
});

export type OrganizadorOutput = z.infer<typeof organizadorOutputSchema>;

/** Input cru de 1 post para o Organizador (PRD §6). */
export interface OrganizadorInput {
  platform: string;
  username: string;
  postid: string;
  alttext: string;
  hashtags: string[];
  mediatype: string | null;
  iscarousel: boolean;
  duration_seconds: number | null;
}
