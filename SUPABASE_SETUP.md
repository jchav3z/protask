# Configuración real de ProTask con Supabase y Resend

## 1. URL correcta

La app usa esta URL base:

```txt
https://ckffdidxajqyezjvdrpa.supabase.co
```

La URL que aparece en Data API con `/rest/v1/` sirve para llamadas REST directas, pero para `supabase-js` y Auth se usa la URL base del proyecto.

## 2. Crear tablas y políticas

1. Entra a Supabase.
2. Abre tu proyecto.
3. Ve a **SQL Editor**.
4. Copia y ejecuta el contenido de `supabase-schema.sql`.

Eso crea:

- `profiles`
- `projects`
- `tasks`
- `task_history`
- `weekly_reports`

También activa Row Level Security para que cada usuario vea solo sus datos.

Si ya habías ejecutado el SQL antes, puedes ejecutarlo nuevamente. No borra tus datos y agrega campos nuevos como la foto de perfil y la función segura para borrar la cuenta desde la app.

## 3. Activar registro/login

En Supabase:

1. Ve a **Authentication > Providers**.
2. Deja activo **Email**.
3. Para una puesta en marcha rápida, puedes desactivar confirmación de correo en **Authentication > Settings**.

Si la confirmación queda activa, el usuario tendrá que validar el correo antes de poder iniciar sesión.

Para recuperación de contraseña, revisa **Authentication > URL Configuration**:

- **Site URL:** usa la URL donde abras la aplicación.
- En local puede ser la ruta del archivo `index.html` o una URL publicada si la subes a Vercel.
- Si Supabase bloquea el enlace, agrega esa misma URL en **Redirect URLs**.

## 3.1 Crear usuarios iniciales

Para operar la aplicación con roles, crea al menos un administrador y un usuario estándar:

1. Ve a **Authentication > Users**.
2. Presiona **Add user**.
3. Crea el administrador:

```txt
Email: admin@protask.cl
Password: admin2026
Auto Confirm User: activado
```

4. Crea el usuario normal:

```txt
Email: alumno@inacapmail.cl
Password: protask2026
Auto Confirm User: activado
```

5. Después vuelve a **SQL Editor** y ejecuta nuevamente `supabase-schema.sql`.

El script asigna:

- `admin@protask.cl` como `admin`
- `alumno@inacapmail.cl` como `student`

El administrador verá una sección **Admin** dentro de la aplicación para revisar usuarios, proyectos, tareas, reportes y cambiar roles.

## 4. Configurar Resend sin exponer la API key

No pongas `RESEND_API_KEY` en `script.js`. Esa clave debe vivir como secreto en Supabase.

En Supabase:

1. Ve a **Edge Functions > Secrets**.
2. Agrega:

```txt
RESEND_API_KEY=tu_api_key_de_resend
```

Como ya compartiste la key en el chat, lo más seguro es generar una nueva en Resend antes de usar la aplicación de forma definitiva.

## 5. Desplegar función de correo

La función está en:

```txt
supabase/functions/send-weekly-report/index.ts
```

Puedes desplegarla desde Supabase CLI:

```txt
supabase login
supabase link --project-ref ckffdidxajqyezjvdrpa
supabase functions deploy send-weekly-report
```

Después, el botón **Generar reporte semanal** guardará el reporte y llamará a esa función para enviar el correo.

## 6. Nota sobre Resend

Con `onboarding@resend.dev`, Resend permite envíos limitados. Para enviar desde un remitente propio, debes verificar un dominio en Resend.
