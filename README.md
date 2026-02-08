# mouro.ai

Personal website for mouro.ai, built with Django and rendered with server-side templates. Static assets are served from the `static/` directory.

## What this site is

- A simple, fast personal site with a home page and projects page.
- Content is rendered by Django views and templates.
- Styling lives in [static/css/site.css](static/css/site.css).

## Tech stack

- Django (Python)
- HTML templates in [templates/](templates/)
- Static assets in [static/](static/)

## Project structure

- [web/](web/) - Django app (views, urls, models)
- [templates/](templates/) - Base layout and pages
- [static/](static/) - CSS and images
- [config/](config/) - Django project settings and routing
