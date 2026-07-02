# Historial de Problemas con Mermaid y Decisión Final

## Contexto

Se buscó agregar una vista visual para:

- `CIM`: diagrama de casos de uso
- `PIM`: diagrama de clases

La primera aproximación fue usar `Mermaid` para renderizar ambos diagramas en el frontend.

## Qué se intentó primero

La implementación inicial seguía esta idea:

- transformar `CIM` y `PIM` a texto Mermaid
- renderizar ese texto en cliente
- mostrar el diagrama antes del panel de `FinOps`

Esto resolvía rápido la parte funcional, pero en la práctica aparecieron problemas de estabilidad en el entorno real del proyecto.

## Problemas encontrados con Mermaid

### 1. Fallos de chunks dinámicos en cliente

Se presentaron errores como:

- `Loading chunk _app-pages-browser_node_modules_mermaid_dist_mermaid_core_mjs failed`

Esto implicaba que el navegador intentaba cargar un chunk generado por Next para Mermaid, pero ese chunk no estaba disponible o quedaba inconsistente entre recompilaciones.

### 2. Errores del dev server de Next

Apareció repetidamente un error más grave:

- `Error: Cannot find module './1682.js'`

Ese error salía desde:

- `.next/server/webpack-runtime.js`
- `.next/server/pages/_document.js`

Aunque no siempre era causado directamente por Mermaid, empezó a ocurrir durante esta integración y mostraba que el flujo de `next dev` estaba quedando sensible a recompilaciones parciales, caché rota o mezcla de artefactos viejos en `.next`.

### 3. Comportamiento inconsistente entre sesiones

Se detectó que podían coexistir varias instancias de `next dev` al mismo tiempo, por ejemplo:

- una en `3000`
- otra en `3001`

Eso volvía difícil saber si el navegador estaba usando:

- el código nuevo
- una sesión vieja
- un bundle viejo cacheado

En ese contexto, un cambio aparentemente correcto podía seguir fallando por una instancia anterior.

### 4. Dependencia innecesaria para un problema visual relativamente simple

Para este caso de uso, Mermaid era una dependencia más pesada de lo necesario:

- añadía complejidad al bundling
- añadía riesgo de chunks extra
- metía una capa runtime adicional solo para dibujar cajas, elipses y líneas

Para `CIM` y `PIM`, el problema real no era “interpretar un lenguaje complejo”, sino dibujar estructuras ya conocidas a partir de JSON controlado por la app.

### 5. Dificultad de validación automática en este entorno

Se intentó validar el render visual con navegador headless, pero el entorno local no tenía todas las librerías del sistema necesarias para Chromium.

Eso impidió usar una prueba visual fuerte como respaldo para seguir confiando en Mermaid dentro de `next dev`.

## Por qué no se continuó con Mermaid

Se decidió no seguir insistiendo con Mermaid por estas razones:

- el problema principal dejó de ser “dibujar UML”
- pasó a ser “hacer estable el entorno de desarrollo”
- Mermaid agregaba una fuente adicional de fragilidad sin aportar una ventaja imprescindible

En otras palabras: el costo técnico de mantener Mermaid en este proyecto fue mayor que su beneficio.

## Solución actual

La solución final fue reemplazar Mermaid por renderizado propio en React/SVG.

### Qué hace ahora la app

- `CIM` se transforma a una estructura de datos para un diagrama de casos de uso
- `PIM` se transforma a una estructura de datos para un diagrama de clases
- ambos se renderizan con componentes propios en SVG

### Archivos principales de la solución actual

- `app/project/[id]/page.tsx`
- `components/UmlDiagrams.tsx`
- `lib/uml.ts`

## Ventajas de la solución actual

### 1. Sin dependencias externas de diagramado

Ya no dependemos de:

- `mermaid`
- imports dinámicos de Mermaid
- chunks generados específicamente para Mermaid

### 2. Menor riesgo de errores de bundling

Los diagramas ahora son solo componentes React y SVG normales.

Eso reduce mucho el riesgo de errores como:

- chunks faltantes
- imports ESM problemáticos
- referencias rotas en runtime

### 3. Render más predecible

Como el layout se calcula desde estructuras conocidas, el comportamiento es más controlable:

- cajas para clases
- elipses para casos de uso
- líneas y multiplicidades definidas por código

### 4. Más fácil de depurar

Si algo falla ahora, el problema probablemente estará en:

- la transformación `JSON -> layout`
- el JSX/SVG

y no en una librería externa de render.

## Medida adicional tomada para estabilizar `next dev`

Además del cambio de diagramas, se agregó limpieza automática de `.next` antes de `dev`.

Archivo:

- `scripts/reset-next-cache.mjs`

Uso en scripts:

- `predev` en `package.json`

Esto se hizo porque los errores de `webpack-runtime` y módulos faltantes indicaban que el caché del dev server podía quedar inconsistente entre intentos.

## Decisión final

La decisión técnica final fue:

1. abandonar Mermaid para esta funcionalidad
2. usar renderizado propio con React/SVG
3. limpiar `.next` automáticamente antes de `next dev`
4. dejar el sistema visualmente útil pero con menos dependencia del bundler y del runtime externo

## Resumen corto

Mermaid funcionaba como idea rápida, pero en este proyecto introdujo demasiada fragilidad en desarrollo.

La solución actual existe porque prioriza:

- estabilidad del proyecto
- control del render
- menor dependencia de tooling externo
- menor probabilidad de errores de chunks o módulos faltantes

