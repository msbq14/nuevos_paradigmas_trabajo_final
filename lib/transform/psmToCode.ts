// ============================================================
//  Transformacion M2T: PSM -> Codigo (PDF etapa 5)
//  La UNICA transformacion M2T del pipeline.
//  Plantillas DETERMINISTAS -> el codigo generado siempre compila
//  y arranca en Docker. Genera: backend Express+Prisma, frontend
//  React+Vite, Dockerfiles y docker-compose.
// ============================================================

import type { PSM, PsmEntity, FileTree } from "../types";

function accessor(name: string): string {
  return name.charAt(0).toLowerCase() + name.slice(1);
}

function routeName(name: string): string {
  const lower = name.toLowerCase();
  return lower.endsWith("s") ? lower : lower + "s";
}

// ---- Prisma schema del backend (solo escalares: garantiza db push OK) ----
function backendPrismaSchema(psm: PSM): string {
  const models = psm.entities.map((e) => e.prismaModel).join("\n\n");
  return `generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "sqlite"
  url      = "file:./prod.db"
}

${models}
`;
}

// ---- Config de entidades embebido en server.js y en el frontend ----
function entityConfig(e: PsmEntity) {
  return {
    model: e.name,
    accessor: accessor(e.name),
    route: routeName(e.name),
    fields: e.fields.map((f) => ({
      name: f.name,
      prismaType: f.prismaType,
      required: f.required,
      unique: f.unique,
    })),
    relations: (e.relations ?? []).map((r) => ({
      name: r.name,
      target: r.target,
      kind: r.kind,
      foreignKey: r.foreignKey,
      targetRoute: routeName(r.target),
    })),
  };
}

// ---- server.js (Express + Prisma, motor CRUD generico, sin backticks) ----
function backendServer(psm: PSM): string {
  const configs = psm.entities.map(entityConfig);
  return `const express = require('express');
const cors = require('cors');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const app = express();
app.use(cors());
app.use(express.json());

const ENTITIES = ${JSON.stringify(configs, null, 2)};

function coerce(field, value) {
  if (value === undefined || value === null || value === '') return undefined;
  switch (field.prismaType) {
    case 'Int': return parseInt(value, 10);
    case 'Float': return parseFloat(value);
    case 'Boolean': return value === true || value === 'true' || value === 1;
    case 'DateTime': return new Date(value);
    default: return String(value);
  }
}

function buildData(entity, body) {
  const data = {};
  for (const f of entity.fields) {
    const v = coerce(f, body[f.name]);
    if (v !== undefined) data[f.name] = v;
  }
  for (const r of entity.relations) {
    if (r.kind !== 'reference') continue;
    const v = body[r.foreignKey];
    if (v !== undefined && v !== null && v !== '') data[r.foreignKey] = parseInt(v, 10);
  }
  return data;
}

function buildInclude(entity) {
  const include = {};
  for (const r of entity.relations) include[r.name] = true;
  return Object.keys(include).length ? include : undefined;
}

app.get('/', (req, res) => res.json({ status: 'ok', entities: ENTITIES.map(function (e) { return e.route; }) }));
app.get('/health', (req, res) => res.json({ status: 'ok' }));

ENTITIES.forEach(function (entity) {
  const model = prisma[entity.accessor];
  const base = '/' + entity.route;
  const include = buildInclude(entity);

  app.get(base, async function (req, res) {
    try { res.json(await model.findMany({ orderBy: { id: 'desc' }, include })); }
    catch (e) { res.status(500).json({ error: String(e) }); }
  });

  app.post(base, async function (req, res) {
    try { res.status(201).json(await model.create({ data: buildData(entity, req.body), include })); }
    catch (e) { res.status(400).json({ error: String(e) }); }
  });

  app.get(base + '/:id', async function (req, res) {
    try {
      const item = await model.findUnique({ where: { id: parseInt(req.params.id, 10) }, include });
      if (!item) return res.status(404).json({ error: 'no encontrado' });
      res.json(item);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  app.put(base + '/:id', async function (req, res) {
    try { res.json(await model.update({ where: { id: parseInt(req.params.id, 10) }, data: buildData(entity, req.body), include })); }
    catch (e) { res.status(400).json({ error: String(e) }); }
  });

  app.delete(base + '/:id', async function (req, res) {
    try { await model.delete({ where: { id: parseInt(req.params.id, 10) } }); res.status(204).end(); }
    catch (e) { res.status(400).json({ error: String(e) }); }
  });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, function () { console.log('Backend escuchando en ' + PORT); });
`;
}

const backendPackageJson = `{
  "name": "generated-backend",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "start": "node src/server.js"
  },
  "dependencies": {
    "@prisma/client": "5.22.0",
    "cors": "2.8.5",
    "express": "4.19.2"
  },
  "devDependencies": {
    "prisma": "5.22.0"
  }
}
`;

const backendDockerfile = `FROM node:20-slim
WORKDIR /app
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
COPY package.json ./
RUN npm install
COPY prisma ./prisma
RUN npx prisma generate
COPY src ./src
EXPOSE 3001
CMD npx prisma db push --skip-generate --accept-data-loss && node src/server.js
`;

// ---- Frontend ----
const frontendPackageJson = `{
  "name": "generated-frontend",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "react": "18.3.1",
    "react-dom": "18.3.1"
  },
  "devDependencies": {
    "@vitejs/plugin-react": "4.3.1",
    "vite": "5.4.8"
  }
}
`;

const viteConfig = `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
});
`;

const indexHtml = `<!doctype html>
<html lang="es">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>App generada (MDD)</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>
`;

const mainJsx = `import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles.css';

createRoot(document.getElementById('root')).render(<App />);
`;

const stylesCss = `* { box-sizing: border-box; }
body { font-family: system-ui, sans-serif; margin: 0; background: #f3f4f6; color: #111827; }
.container { max-width: 960px; margin: 0 auto; padding: 24px; }
.tabs { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 20px; }
.tab { padding: 8px 16px; border: 1px solid #d1d5db; background: #fff; border-radius: 6px; cursor: pointer; }
.tab.active { background: #2563eb; color: #fff; border-color: #2563eb; }
.card { background: #fff; border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px; margin-bottom: 16px; }
.row { display: flex; gap: 12px; flex-wrap: wrap; align-items: end; }
.field { display: flex; flex-direction: column; gap: 4px; }
.field label { font-size: 12px; color: #6b7280; }
.field input { padding: 6px 8px; border: 1px solid #d1d5db; border-radius: 4px; }
button { padding: 8px 14px; background: #2563eb; color: #fff; border: none; border-radius: 6px; cursor: pointer; }
button.danger { background: #dc2626; }
table { width: 100%; border-collapse: collapse; }
th, td { text-align: left; padding: 8px; border-bottom: 1px solid #e5e7eb; font-size: 14px; }
.error { color: #dc2626; font-size: 14px; margin-top: 8px; }
h1 { font-size: 22px; } h2 { font-size: 16px; margin-top: 0; }
`;

// Componente generico CRUD (sin backticks, sin ${ literales).
const crudViewJsx = `import React, { useEffect, useState } from 'react';

const API = '/api';

function inputType(prismaType) {
  if (prismaType === 'Int' || prismaType === 'Float') return 'number';
  if (prismaType === 'Boolean') return 'checkbox';
  if (prismaType === 'DateTime') return 'date';
  return 'text';
}

function relationLabel(item) {
  if (!item) return '';
  const skip = { id: true, createdAt: true };
  const keys = Object.keys(item);
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i];
    if (skip[k]) continue;
    if (typeof item[k] === 'string') return item[k];
  }
  return '#' + item.id;
}

export default function CrudView(props) {
  const config = props.config;
  const route = config.route;
  const refRelations = (config.relations || []).filter(function (r) { return r.kind === 'reference'; });
  const [items, setItems] = useState([]);
  const [form, setForm] = useState({});
  const [error, setError] = useState('');
  const [relOptions, setRelOptions] = useState({});

  function load() {
    fetch(API + '/' + route)
      .then(function (r) { return r.json(); })
      .then(function (d) { setItems(Array.isArray(d) ? d : []); })
      .catch(function (e) { setError(String(e)); });
  }

  useEffect(function () { load(); }, [route]);

  useEffect(function () {
    refRelations.forEach(function (r) {
      fetch(API + '/' + r.targetRoute)
        .then(function (resp) { return resp.json(); })
        .then(function (data) {
          setRelOptions(function (prev) {
            const next = Object.assign({}, prev);
            next[r.foreignKey] = Array.isArray(data) ? data : [];
            return next;
          });
        })
        .catch(function (e) { setError(String(e)); });
    });
  }, [route]);

  function setField(name, value) {
    setForm(function (prev) { const next = Object.assign({}, prev); next[name] = value; return next; });
  }

  function submit(e) {
    e.preventDefault();
    setError('');
    fetch(API + '/' + route, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    })
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (res) {
        if (!res.ok) { setError((res.d && res.d.error) || 'Error al crear'); }
        else { setForm({}); load(); }
      })
      .catch(function (e) { setError(String(e)); });
  }

  function del(id) {
    fetch(API + '/' + route + '/' + id, { method: 'DELETE' }).then(load);
  }

  return (
    <div>
      <div className="card">
        <h2>Nuevo {config.model}</h2>
        <form onSubmit={submit}>
          <div className="row">
            {config.fields.map(function (f) {
              const t = inputType(f.prismaType);
              return (
                <div className="field" key={f.name}>
                  <label>{f.name}{f.required ? ' *' : ''}</label>
                  {t === 'checkbox' ? (
                    <input type="checkbox" checked={!!form[f.name]} onChange={function (e) { setField(f.name, e.target.checked); }} />
                  ) : (
                    <input type={t} value={form[f.name] === undefined ? '' : form[f.name]} onChange={function (e) { setField(f.name, e.target.value); }} />
                  )}
                </div>
              );
            })}
            {refRelations.map(function (r) {
              const options = relOptions[r.foreignKey] || [];
              return (
                <div className="field" key={r.foreignKey}>
                  <label>{r.name} *</label>
                  <select value={form[r.foreignKey] === undefined ? '' : form[r.foreignKey]} onChange={function (e) { setField(r.foreignKey, e.target.value); }}>
                    <option value="">-- seleccionar --</option>
                    {options.map(function (opt) {
                      return <option key={opt.id} value={opt.id}>{relationLabel(opt)}</option>;
                    })}
                  </select>
                </div>
              );
            })}
            <button type="submit">Crear</button>
          </div>
          {error ? <div className="error">{error}</div> : null}
        </form>
      </div>

      <div className="card">
        <h2>{config.model} ({items.length})</h2>
        <table>
          <thead>
            <tr>
              <th>id</th>
              {config.fields.map(function (f) { return <th key={f.name}>{f.name}</th>; })}
              <th></th>
            </tr>
          </thead>
          <tbody>
            {items.map(function (it) {
              return (
                <tr key={it.id}>
                  <td>{it.id}</td>
                  {config.fields.map(function (f) { return <td key={f.name}>{String(it[f.name] === null || it[f.name] === undefined ? '' : it[f.name])}</td>; })}
                  <td><button className="danger" onClick={function () { del(it.id); }}>Borrar</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
`;

function entityViewJsx(e: PsmEntity): string {
  const config = entityConfig(e);
  return `import React from 'react';
import CrudView from '../CrudView.jsx';

const config = ${JSON.stringify(config, null, 2)};

export default function ${e.name}View() {
  return <CrudView config={config} />;
}
`;
}

function appJsx(psm: PSM): string {
  const imports = psm.entities
    .map((e) => `import ${e.name}View from './components/${e.name}View.jsx';`)
    .join("\n");
  const tabs = psm.entities
    .map((e) => `  { name: '${e.name}', Comp: ${e.name}View }`)
    .join(",\n");
  return `import React, { useState } from 'react';
${imports}

const TABS = [
${tabs}
];

export default function App() {
  const [active, setActive] = useState(0);
  const Current = TABS[active].Comp;
  return (
    <div className="container">
      <h1>App generada por el pipeline MDD</h1>
      <div className="tabs">
        {TABS.map(function (t, i) {
          return (
            <div key={t.name} className={'tab' + (i === active ? ' active' : '')} onClick={function () { setActive(i); }}>
              {t.name}
            </div>
          );
        })}
      </div>
      <Current />
    </div>
  );
}
`;
}

const nginxConf = `server {
  listen 80;
  server_name _;
  root /usr/share/nginx/html;
  index index.html;

  location /api/ {
    proxy_pass http://backend:3001/;
    proxy_set_header Host $host;
  }

  location / {
    try_files $uri $uri/ /index.html;
  }
}
`;

const frontendDockerfile = `FROM node:20-slim AS build
WORKDIR /app
COPY package.json ./
RUN npm install
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
`;

function dockerCompose(frontendPort: number, backendPort: number): string {
  return `services:
  backend:
    build: ./backend
    ports:
      - "${backendPort}:3001"
    restart: unless-stopped

  frontend:
    build: ./frontend
    ports:
      - "${frontendPort}:80"
    depends_on:
      - backend
    restart: unless-stopped
`;
}

export interface CodeGenMeta {
  projectName: string;
  frontendPort: number;
  backendPort: number;
}

/** Genera el arbol de archivos completo de la app desplegable. */
export function psmToCode(psm: PSM, meta: CodeGenMeta): FileTree {
  const files: FileTree = {};

  // Backend
  files["backend/package.json"] = backendPackageJson;
  files["backend/prisma/schema.prisma"] = backendPrismaSchema(psm);
  files["backend/src/server.js"] = backendServer(psm);
  files["backend/Dockerfile"] = backendDockerfile;
  files["backend/.dockerignore"] = "node_modules\nprod.db\n";

  // Frontend
  files["frontend/package.json"] = frontendPackageJson;
  files["frontend/vite.config.js"] = viteConfig;
  files["frontend/index.html"] = indexHtml;
  files["frontend/nginx.conf"] = nginxConf;
  files["frontend/Dockerfile"] = frontendDockerfile;
  files["frontend/.dockerignore"] = "node_modules\ndist\n";
  files["frontend/src/main.jsx"] = mainJsx;
  files["frontend/src/styles.css"] = stylesCss;
  files["frontend/src/CrudView.jsx"] = crudViewJsx;
  files["frontend/src/App.jsx"] = appJsx(psm);
  for (const e of psm.entities) {
    files[`frontend/src/components/${e.name}View.jsx`] = entityViewJsx(e);
  }

  // Infra
  files["docker-compose.yml"] = dockerCompose(meta.frontendPort, meta.backendPort);
  files["README.md"] = `# ${meta.projectName} (generado por el pipeline MDD)

Generado automaticamente. Levanta con:

    docker compose up -d --build

- Frontend: http://localhost:${meta.frontendPort}
- Backend:  http://localhost:${meta.backendPort}

Entidades: ${psm.entities.map((e) => e.name).join(", ")}
`;

  return files;
}
