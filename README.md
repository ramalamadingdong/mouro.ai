# mouro.ai

Personal website built with Django.

## Local development

1. Create and activate a virtual environment:
   - `python -m venv .venv`
   - `source .venv/bin/activate`
2. Install dependencies:
   - `pip install -r requirements.txt`
3. Create a local env file:
   - `cp .env.example .env`
4. Run migrations and start the server:
   - `python manage.py migrate`
   - `python manage.py runserver`

## Production setup (Gunicorn + Nginx)

These notes assume Ubuntu/Debian. Replace `rami` with your Linux user.

1. Point DNS A records for `mouro.ai` and `www.mouro.ai` to this machine's public IP.
2. Create `.env` with production values.
3. Collect static files:
   - `python manage.py collectstatic`
4. Install Gunicorn service:
   - Copy [deploy/gunicorn.socket](deploy/gunicorn.socket) to `/etc/systemd/system/gunicorn.socket`
   - Copy [deploy/gunicorn.service](deploy/gunicorn.service) to `/etc/systemd/system/gunicorn.service`
   - `sudo systemctl daemon-reload`
   - `sudo systemctl enable --now gunicorn.socket`
5. Install Nginx config:
   - Copy [deploy/nginx.conf](deploy/nginx.conf) to `/etc/nginx/sites-available/mouro.ai`
   - `sudo ln -s /etc/nginx/sites-available/mouro.ai /etc/nginx/sites-enabled/`
   - `sudo nginx -t && sudo systemctl reload nginx`
6. (Optional) HTTPS with Let's Encrypt:
   - `sudo apt install certbot python3-certbot-nginx`
   - `sudo certbot --nginx -d mouro.ai -d www.mouro.ai`

## GitHub

Initialize a repo and push:

- `git init`
- `git add .`
- `git commit -m "Initial Django site"`
- `git remote add origin <your-repo-url>`
- `git push -u origin main`
