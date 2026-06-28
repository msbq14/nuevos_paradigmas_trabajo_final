# Pipeline MDD — Contexto del Proyecto

## Qué es este proyecto
Sistema web que implementa Model-Driven Development (MDD) asistido por IA.
Toma requisitos en lenguaje natural y guía al usuario por 6 etapas:
Chat → CIM → PIM (M2M) → PSM (M2M) → Código (M2T) → Despliegue Docker.
Cada etapa requiere aprobación del usuario antes de continuar.

## Stack
- Plataforma: Next.js App Router + PostgreSQL + Prisma ORM
- DeepSeek API como LLM backbone (NO Anthropic/OpenAI)
- Producto generado: Node.js/Express (backend) + React (frontend)
- Despliegue: docker-compose generado dinámicamente

## Estructura de carpetas
/app          → Next.js App Router (páginas y rutas API)
/lib          → Cliente DeepSeek, utilidades compartidas
/prisma       → schema.prisma y migraciones
/schemas      → JSON Schemas de los metamodelos CIM, PIM y PSM
/templates    → Templates base del proyecto Node+React generado

## Convenciones
- TypeScript estricto en todo el proyecto
- Prisma para TODAS las queries — sin SQL crudo
- Cada etapa del pipeline tiene status: pending | generating | approved | rejected
- Los prompts a DeepSeek siempre incluyen el contexto acumulado de etapas anteriores
- Sin autenticación — proyecto universitario de contexto controlado

## Metamodelos (crítico)
- CIM: FR/NFR/actores en JSON, validado con Zod
- PIM: entidades con atributos y relaciones, agnóstico de plataforma
- PSM: schema Prisma + endpoints REST + specs de componentes React
- Si DeepSeek devuelve JSON inválido, reintentar máx. 3 veces con el error como contexto

## Lo que NO hacer
- No hardcodear ningún dominio (biblioteca, inventario, etc.) — el sistema debe ser genérico
- No saltarse la validación del metamodelo antes de guardar en DB
- No avanzar de etapa sin que la anterior esté en status approved