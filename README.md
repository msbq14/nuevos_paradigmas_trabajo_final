# Pipeline MDD asistido por IA

Orquestador de desarrollo dirigido por modelos (MDA) asistido por DeepSeek.
Lleva una descripción en **lenguaje natural** hasta una app **backend + frontend
corriendo en Docker**, pasando explícitamente por cada capa del framework MDA:

```
Lenguaje natural → CIM → PIM → PSM → Código → Despliegue Docker
   (chat)        (etapa2) (M2M)  (M2M)   (M2T)      (etapa6)
```

- **Plataforma:** Next.js (App Router) + Prisma + SQLite + DeepSeek
- **Producto generado:** Express + Prisma + SQLite (backend) · React + Vite (frontend)
- **Despliegue:** `docker-compose` generado dinámicamente

## Requisitos previos

- Node.js 18+ (probado con Node 24)
- Docker Desktop corriendo (para la etapa 6)
- Una **API key de DeepSeek**

## Puesta en marcha (lo único que tienes que hacer)

```bash
# 1. Instalar dependencias
npm install

# 2. Configurar la API key
#    Copia el ejemplo y pega tu key en DEEPSEEK_API_KEY
cp .env.example .env
#    (en Windows PowerShell:  Copy-Item .env.example .env )

# 3. (opcional) Verificar que la API key funciona
node scripts/check-deepseek.mjs

# 4. Arrancar
npm run dev
```

Abre http://localhost:3000

> `npm run dev` ejecuta automáticamente `prisma generate` + `prisma db push`
> (crea la base SQLite `prisma/dev.db`). No necesitas instalar ninguna base de datos.

### ⚠️ Si la interfaz "no hace nada" al hacer clic (Console Ninja)

Si tienes instalada la extensión de VS Code **Console Ninja**, ésta inyecta
instrumentación en el bundle de `next dev` que **rompe la hidratación de React**:
la página se ve pero ningún botón responde, sin mostrar error.

Tienes dos opciones:

1. **Modo producción (recomendado, inmune a Console Ninja):**
   ```bash
   npm run go      # build + start en un solo comando
   ```
   La app queda en http://localhost:3000 igual de funcional (incluso más rápida).

2. **Seguir en modo dev:** pausa Console Ninja —
   `Ctrl+Shift+P` → escribe **"Console Ninja: Pause"** (o haz clic en
   "Console Ninja" en la barra de estado inferior) — y vuelve a `npm run dev`.

## Cómo se usa

1. **Crear proyecto** y entrar.
2. **Etapa 1 – Requisitos:** describe el sistema en el chat. DeepSeek hace preguntas
   de analista. Pulsa **Finalizar y formalizar**.
3. **Etapas 2–5:** en cada pestaña, **Generar** → revisar/editar el JSON → **Aprobar**.
   No se puede avanzar a la etapa N+1 si la N no está *approved*.
4. **Etapa 6 – Docker:** **desplegar** levanta los contenedores y muestra las URLs.

### Modo automático

El botón **⚡ Auto-run** ejecuta CIM → PIM → PSM → Código (genera y auto-aprueba)
y lanza el despliegue Docker sin intervención. Solo necesitas haber escrito al menos
un mensaje describiendo el sistema en el chat.

## Arquitectura: dónde se usa IA y dónde determinismo

Esto es lo que hace que el despliegue **no falle**:

| Etapa | Tipo | Motor |
|-------|------|-------|
| CIM   | Texto→Modelo | DeepSeek + validación JSON Schema + reintento (máx 3) |
| PIM   | M2M | DeepSeek + validación JSON Schema + reintento (máx 3) |
| PSM   | M2M | **Programático** (mapeo de tipos PIM→Prisma, CRUD automático) + enriquecimiento LLM opcional |
| Código| M2T | **Plantillas deterministas** → el código siempre compila |
| Docker| — | `docker compose up -d --build` |

Los metamodelos (JSON Schema) de CIM/PIM/PSM están en [`lib/schemas.ts`](lib/schemas.ts).

## Estructura

```
app/                       UI (App Router) + rutas API
  api/projects/...         CRUD de proyectos, chat, etapas, deploy, autorun
  project/[id]/page.tsx    UI del pipeline de 6 etapas
lib/
  deepseek.ts              cliente DeepSeek reutilizable (callDeepSeek)
  prompts.ts               system prompts (genéricos, sin asumir dominio)
  schemas.ts               metamodelos CIM/PIM/PSM (JSON Schema)
  validate.ts              validación AJV
  pipeline.ts              orquestación de cada etapa (con reintentos)
  transform/
    pimToPsm.ts            M2M determinista
    psmToCode.ts           M2T (plantillas de la app generada)
  deploy.ts                escritura de archivos + docker compose
prisma/schema.prisma       modelo de datos de la plataforma
generated-apps/<id>/       apps generadas que se despliegan
```

## Cambiar a PostgreSQL (como en el documento original)

En `prisma/schema.prisma` cambia el `datasource` a `postgresql`, pon una
`DATABASE_URL` de Postgres en `.env`, y corre `npm run db:push`.

## Notas / límites (scope del proyecto)

- Sin autenticación (un solo usuario), por diseño.
- Las relaciones del PIM se modelan y muestran, pero la app generada implementa
  CRUD sobre campos escalares (decisión de robustez para que `prisma db push`
  nunca falle en el contenedor).
- Cada proyecto usa puertos derivados de su id para no colisionar.
