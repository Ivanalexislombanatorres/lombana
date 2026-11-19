"""Prueba de punta a punta en navegador real (Playwright + Chromium).

Requiere el servidor corriendo con una base vacía:
    LOMBANA_DATA_DIR=/tmp/le/data python -m uvicorn app.main:app --port 8000   (desde backend/)
Ejecutar:  pytest tests/e2e -q
"""
import os
import re
from pathlib import Path

import pytest
from playwright.sync_api import expect, sync_playwright

BASE = os.environ.get("LOMBANA_E2E_URL", "http://127.0.0.1:8000")
SHOTS = Path(__file__).resolve().parents[2] / "docs" / "capturas"
SHOTS.mkdir(parents=True, exist_ok=True)


@pytest.fixture(scope="module")
def page():
    with sync_playwright() as p:
        b = p.chromium.launch()
        ctx = b.new_context(viewport={"width": 1440, "height": 900}, locale="es-CO", timezone_id="America/Bogota")
        pg = ctx.new_page()
        pg.errors = []
        pg.on("pageerror", lambda e: pg.errors.append(str(e)))
        pg.on("console", lambda m: m.type == "error" and pg.errors.append(m.text))
        yield pg
        b.close()


def pick(select, text):
    select.select_option(select.locator("option", has_text=text).first.get_attribute("value"))


def shot(page, name):
    page.wait_for_timeout(400)
    page.screenshot(path=str(SHOTS / f"{name}.png"), full_page=True)


def test_01_configuracion_inicial(page):
    page.goto(f"{BASE}/")
    expect(page).to_have_url(re.compile("/login"))
    expect(page.get_by_text("Configuración inicial")).to_be_visible()
    page.get_by_label("Nombre").fill("Andrés Lombana")
    page.get_by_label("Correo").fill("admin@lombana.co")
    page.get_by_label("Contraseña", exact=True).fill("Clave-Segura-1")
    page.get_by_label("Repetir contraseña").fill("Clave-Segura-1")
    shot(page, "01_configuracion_inicial")
    page.get_by_role("button", name="Crear administrador y entrar").click()
    expect(page.get_by_test_id("stat-erps_activos")).to_have_text("0")


def test_02_constructor_crea_erp(page):
    page.goto(f"{BASE}/constructor?sector=barberia")
    page.get_by_role("button", name="Siguiente").click()
    page.get_by_placeholder("Barbería Pro").fill("Barbería Pro")
    page.get_by_placeholder("Barbería El Rey S.A.S.").fill("Barbería El Rey")
    page.get_by_role("button", name="Siguiente").click()
    expect(page.get_by_label("Registros personalizados")).to_be_checked()
    page.get_by_role("button", name="Siguiente").click()
    expect(page.get_by_test_id("entity-citas")).to_be_visible()
    page.get_by_role("button", name="Siguiente").click()
    expect(page.get_by_test_id("brand-preview")).to_contain_text("Barbería Pro")
    shot(page, "02_constructor_marca")
    page.get_by_role("button", name="Siguiente").click()
    page.get_by_label("Contraseña", exact=True).fill("Admin-12345")
    page.get_by_label("Repetir contraseña").fill("Admin-12345")
    page.get_by_role("button", name="Crear y publicar ERP").click()
    expect(page.get_by_role("heading", name="Barbería Pro")).to_be_visible()
    expect(page.get_by_text("erp_barberia_001").first).to_be_visible()
    expect(page.get_by_text("Conectada")).to_be_visible()
    shot(page, "03_detalle_erp")


def test_03_dashboard_fabrica(page):
    page.goto(f"{BASE}/")
    expect(page.get_by_test_id("stat-erps_activos")).to_have_text("1")
    expect(page.get_by_text("Barbería Pro")).to_be_visible()
    shot(page, "04_dashboard_fabrica")


def test_04_marca_publicada(page):
    page.goto(f"{BASE}/marca")
    name = page.get_by_label("Nombre del software")
    name.fill("Barber Gold")
    page.get_by_label("Principal", exact=True).fill("#c9a227")
    expect(page.get_by_test_id("brand-preview")).to_contain_text("Barber Gold")
    page.get_by_role("button", name="Guardar y publicar").click()
    expect(page.get_by_text("Marca guardada y publicada")).to_be_visible()
    shot(page, "05_editor_marca")


def test_05_runtime_operacion_real(page):
    page.goto(f"{BASE}/erp/barberia-pro/login")
    expect(page.get_by_role("heading", name="Barber Gold")).to_be_visible()
    shot(page, "06_login_erp_cliente")
    page.get_by_label("Usuario").fill("admin")
    page.get_by_label("Contraseña").fill("Admin-12345")
    page.get_by_role("button", name="Ingresar").click()
    expect(page.get_by_text("Ventas del mes")).to_be_visible()
    # cliente
    page.get_by_role("link", name="Clientes").click()
    page.get_by_role("button", name="Nuevo").click()
    page.locator("input[name=name]").fill("Carlos Gómez")
    page.get_by_role("button", name="Guardar").click()
    expect(page.get_by_role("cell", name="Carlos Gómez")).to_be_visible()
    # servicio y producto
    page.get_by_role("link", name="Servicios y productos").click()
    for sku, nombre, precio, stock in (("C1", "Corte clásico", "30000", None), ("P1", "Cera para cabello", "25000", "10")):
        page.get_by_role("button", name="Nuevo").click()
        page.locator("input[name=sku]").fill(sku)
        page.locator("input[name=name]").fill(nombre)
        if stock is None:
            page.get_by_role("dialog").locator("select").select_option("servicio")
        page.locator("input[name=price]").fill(precio)
        if stock:
            page.locator("input[name=initial_stock]").fill(stock)
        page.get_by_role("button", name="Guardar").click()
        expect(page.get_by_role("cell", name=nombre)).to_be_visible()
    # venta
    page.get_by_role("link", name="Ventas").click()
    page.get_by_role("button", name="Nueva venta").click()
    dlg = page.get_by_role("dialog")
    dlg.locator("select").first.select_option(label="Carlos Gómez")
    pick(dlg.get_by_label("Agregar producto"), "Corte clásico")
    pick(dlg.get_by_label("Agregar producto"), "Cera para cabello")
    dlg.get_by_label("Cantidad").nth(1).fill("2")
    expect(dlg.get_by_test_id("sale-total")).to_contain_text("80.000")
    dlg.get_by_role("button", name="Confirmar venta").click()
    expect(page.get_by_role("dialog", name=re.compile("Venta V-000001"))).to_be_visible()
    expect(page.get_by_role("dialog").get_by_text("ANULADA")).to_have_count(0)
    shot(page, "07_factura_venta")
    page.keyboard.press("Escape")
    # registro personalizado con campo calculado (comisión)
    page.get_by_role("link", name="Citas").click()
    page.get_by_role("button", name="Nuevo").click()
    dlg = page.get_by_role("dialog")
    dlg.locator("select").nth(0).select_option(label="Carlos Gómez")
    dlg.locator("input").nth(0).fill("Andrés")
    dlg.locator("input[type=date]").fill("2026-11-20")
    dlg.locator("input").nth(2).fill("10:30")
    dlg.locator("select").nth(1).select_option("Corte")
    dlg.locator("input[type=number]").nth(0).fill("30000")
    dlg.locator("input[type=number]").nth(1).fill("40")
    dlg.get_by_role("button", name="Guardar").click()
    expect(page.get_by_role("cell", name="12.000")).to_be_visible()
    shot(page, "08_citas_comision_calculada")
    page.get_by_role("link", name="Dashboard").click()
    expect(page.get_by_text("Más vendidos del mes")).to_be_visible()
    expect(page.get_by_text("$ 80.000").first).to_be_visible()
    shot(page, "09_dashboard_erp_cliente")


def test_06_paginas_fabrica_sin_errores(page):
    for path, texto in (("/erps", "Mis ERP"), ("/sectores", "Plantillas por Sector"), ("/ia", "LOMBANA AI Gateway"),
                        ("/agentes", "Agentes de IA"), ("/formulas", "Fórmulas y Cálculos"), ("/bases", "Bases de Datos"),
                        ("/clientes", "Clientes y Licencias"), ("/auditoria", "Auditoría de la fábrica"), ("/configuracion", "Configuración")):
        page.goto(f"{BASE}{path}")
        expect(page.get_by_role("heading", name=texto)).to_be_visible()
    page.goto(f"{BASE}/formulas")
    expect(page.get_by_test_id("formula-result")).to_contain_text("120000")
    shot(page, "10_formulas")
    page.goto(f"{BASE}/ia")
    page.get_by_role("button", name="OpenAI", exact=True).click()
    expect(page.get_by_test_id("provider-openai")).to_contain_text("sin probar")
    page.get_by_test_id("provider-openai").get_by_role("button", name="Probar conexión").click()
    expect(page.get_by_test_id("provider-openai")).to_contain_text("Falta la API key")
    shot(page, "11_ai_gateway")
    page.goto(f"{BASE}/bases")
    expect(page.get_by_role("cell", name="erp_barberia_001", exact=True)).to_be_visible()
    shot(page, "12_bases_de_datos")
    assert not [e for e in page.errors if "Failed to load resource" not in e], page.errors
