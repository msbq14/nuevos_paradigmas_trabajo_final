# Pipeline MDD — Contexto del Proyecto

## Qué es este proyecto
Sistema web que implementa Model-Driven Development (MDD) asistido por IA.
Toma requisitos en lenguaje natural y guía al usuario por 6 etapas:
Chat → CIM → PIM (M2M) → PSM (M2M) → Código (M2T) → Despliegue Docker.
Cada etapa requiere aprobación del usuario antes de continuar.

## Stack
- Plataforma: Next.js App Router + SQLite + Prisma ORM (provider "sqlite", cero-setup;
  schema.prisma documenta cómo cambiar a PostgreSQL si se necesita)
- DeepSeek API como LLM backbone (NO Anthropic/OpenAI)
- Producto generado: Node.js/Express (backend) + React (frontend)
- Despliegue: docker-compose generado dinámicamente

## Estructura de carpetas
/app                → Next.js App Router (páginas y rutas API en /app/api/projects/...)
/lib                → Cliente DeepSeek, prompts, validación y orquestación del pipeline
/lib/schemas.ts     → Metamodelos CIM, PIM y PSM (JSON Schema, validados con Ajv)
/lib/transform      → Transformaciones M2M (pimToPsm.ts) y M2T (psmToCode.ts)
/prisma             → schema.prisma (SQLite) + dev.db; sin carpeta migrations, se usa `prisma db push`
/generated-apps     → Salida de la Etapa 6: una carpeta por proyecto con la app generada y su docker-compose.yml

## Convenciones
- TypeScript estricto en todo el proyecto
- Prisma para TODAS las queries — sin SQL crudo
- Cada etapa del pipeline tiene status: pending | generating | approved | rejected
- Los prompts a DeepSeek siempre incluyen el contexto acumulado de etapas anteriores
- Sin autenticación — proyecto universitario de contexto controlado

## Metamodelos (crítico)
- CIM: FR/NFR/actores en JSON, validado con Ajv (JSON Schema, ver lib/schemas.ts y lib/validate.ts)
- PIM: entidades con atributos y relaciones, agnóstico de plataforma
- PSM: schema Prisma + endpoints REST + specs de componentes React
- Si DeepSeek devuelve JSON inválido, reintentar máx. 3 veces con el error como contexto
- La validación contra el metamodelo también aplica a ediciones manuales (acción "edit"),
  no solo a la generación inicial

## Lo que NO hacer
- No hardcodear ningún dominio (biblioteca, inventario, etc.) — el sistema debe ser genérico
- No saltarse la validación del metamodelo antes de guardar en DB
- No avanzar de etapa sin que la anterior esté en status approved