# Cómo publicar Agua Prieta con Sentido en Railway

El proyecto ya está listo para desplegarse (variables de entorno, disco persistente, cookies seguras). Esto es lo que falta hacer del lado de Railway — son pasos que tienes que hacer tú, con tu propia cuenta.

## 1. Sube el código a GitHub

Si no tienes ya un repositorio, crea uno en https://github.com/new (puede ser privado). Luego, en esta carpeta:

```bash
git init
git add .
git commit -m "Primera versión de Agua Prieta con Sentido"
git branch -M main
git remote add origin https://github.com/TU-USUARIO/TU-REPO.git
git push -u origin main
```

## 2. Crea tu cuenta en Railway

Entra a https://railway.app y regístrate (lo más simple es "Continuar con GitHub").

## 3. Crea el proyecto

- **New Project** → **Deploy from GitHub repo** → elige el repositorio que acabas de subir.
- Railway detecta que es Node.js solo y usa `npm install` + `npm start` automáticamente (ya están definidos en `package.json`).

## 4. Agrega un volumen (disco persistente) — importante

Sin esto, la base de datos se borra cada vez que Railway vuelve a desplegar el sitio.

- Entra al servicio → pestaña **Volumes** → **New Volume**.
- Ponle como *mount path*: `/data`

## 5. Configura las variables de entorno

Servicio → pestaña **Variables** → agrega:

| Variable | Valor |
|---|---|
| `DATA_DIR` | `/data` (debe coincidir con el mount path del volumen) |
| `NODE_ENV` | `production` |
| `ADMIN_EMAIL` | el correo con el que va a entrar el administrador |
| `ADMIN_PASSWORD` | una contraseña **nueva** — no reutilices la que usamos en local durante las pruebas |

`ADMIN_EMAIL`/`ADMIN_PASSWORD` solo se usan la primera vez que arranca, para crear la cuenta admin del sitio en vivo. Después de ese primer arranque puedes dejarlas o quitarlas, da igual.

## 6. Despliega

Railway construye y arranca el sitio solo. Te da una URL tipo `https://tu-proyecto.up.railway.app` con HTTPS incluido — ya funciona en automático porque `NODE_ENV=production` activa las cookies seguras.

Entra con el `ADMIN_EMAIL`/`ADMIN_PASSWORD` que pusiste, confirma que puedes ver el panel admin.

## 7. (Opcional, después) Dominio propio

Si compran un dominio como `aguaprietaconsentido.com`:

- Servicio → **Settings** → **Domains** → **Custom Domain** → escribe el dominio.
- Railway te da un registro CNAME — lo agregas donde compraron el dominio (GoDaddy, Namecheap, etc.).

## Respaldos

`npm run backup` sigue funcionando igual en Railway (guarda dentro de `/data/backups`, que también vive en el volumen persistente). Para bajarte esos archivos a tu computadora necesitas la [Railway CLI](https://docs.railway.app/guides/cli) — si llegas a ese punto y quieres ayuda, dime.
