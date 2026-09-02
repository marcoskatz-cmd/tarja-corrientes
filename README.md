# Tarja Diaria y Checklist de Equipos — Obra Corrientes

Registro diario de horas y estado de la **PC200** y la **Hidromek** destinadas a la obra
de Corrientes, con respaldo fotográfico objetivo para sostener la certificación de
prestaciones.

## Estructura

- `apps-script/` — backend (Google Apps Script). API JSON, planilla y fotos en Drive.
- `docs/` — PWA del operador (`index.html`) y panel de control (`panel.html`),
  publicadas por GitHub Pages.

## Por qué el front no usa HtmlService

Cuando el celular tiene más de una cuenta de Google logueada, `HtmlService` rutea por
`/u/N` y la PWA instalada se rompe. Con celulares de terceros ese riesgo es alto, así
que el front va estático en Pages y Apps Script queda como API pura (`doPost` +
`ContentService`).

## Deploy

Backend:

    cd apps-script
    clasp push
    clasp create-deployment --description "vN"

Front: `git push` (GitHub Pages sirve `docs/`).

Nunca copiar y pegar código en el editor online.

## Instalación por única vez

1. Abrir `<URL del web app>?action=setup` en el navegador, con la cuenta dueña del
   script. Crea la planilla, la carpeta de Drive y los datos semilla, y devuelve la
   clave de instalación.
2. Definir los PIN del panel:
   `<URL>?action=set_pin&key=<clave>&rol=admin&pin=1234` y lo mismo con `rol=taller`.
3. Verificar: `<URL>?action=ping`.

## Política editable sin tocar código

En la planilla:

- `CHECKLIST_ITEMS` — ítems, por equipo y frecuencia.
- `MOTIVOS` — motivos de detención y a quién se imputan.
- `EQUIPOS` — banda de consumo, próximo service, dispositivo vinculado.

Si una columna cambia de nombre o de lugar, el panel lo avisa en la pestaña **Hoy**
en vez de fallar en silencio.

## IDs de deploy

- scriptId: `1Wy1fyO5CIKrVu7rixUM4KB-0JH-IVLl3zF-Arm7bFBD5lrHxizgBI-6d`
- deploymentId (URL estable, **no crear uno nuevo**):
  `AKfycbxwItT5p7VrxMVr-v0PCOJ0vb5Qm5p6GmZmdTPJAh3-43FiQkp84OQnT3nf6lJY8zIe2w`

Para publicar una versión nueva del backend:

    clasp push
    clasp update-deployment -d "vN" AKfycbxwItT5p7VrxMVr-v0PCOJ0vb5Qm5p6GmZmdTPJAh3-43FiQkp84OQnT3nf6lJY8zIe2w

`clasp create-deployment` genera una URL distinta y deja la PWA apuntando a la vieja.

## Anular vs borrar

- **Anular** (panel → Equipo → historial, solo administración): la fila queda en la planilla con
  el motivo y en el `LOG`, y sale del consolidado. Es el camino normal para un registro operativo.
- **Borrar de verdad**: solo para limpiar datos de prueba. No se expone en el panel. Va por
  `<URL>?action=borrar_tarja&key=<clave>&equipo=PC200&fecha=2026-09-02`, que **informa qué se
  borraría sin tocar nada**; recién agregando `&aplicar=si` elimina las filas, manda las fotos a
  la papelera de Drive y devuelve el horómetro del equipo al valor previo.
