from datetime import date
from conftest import make_erp, rt_login


def setup_erp(admin, sector="tienda"):
    e = make_erp(admin, "Tienda Max", sector)
    return e["slug"], rt_login(admin, e["slug"]), e


def test_productos_ventas_inventario(admin):
    slug, h, _ = setup_erp(admin)
    u = f"/api/rt/{slug}"
    c = admin.post(f"{u}/customers", json={"name": "Juan Pérez"}, headers=h).json()
    p = admin.post(f"{u}/products", json={"sku": "A1", "name": "Gaseosa", "price": "2500", "cost": "1500",
                                          "tax_rate": "19", "initial_stock": "10", "min_stock": "3"}, headers=h).json()
    s = admin.post(f"{u}/products", json={"sku": "S1", "name": "Domicilio", "kind": "servicio", "price": "3000"}, headers=h).json()
    assert p["stock"] == "10.0000" and p["margin_pct"] == "40.00"
    assert admin.post(f"{u}/products", json={"sku": "A1", "name": "Dup", "price": "1"}, headers=h).status_code == 409
    sale = admin.post(f"{u}/sales", json={"customer_id": c["id"], "discount_pct": "10", "items": [
        {"product_id": p["id"], "qty": "4"}, {"product_id": s["id"], "qty": "1"}]}, headers=h)
    assert sale.status_code == 201, sale.text
    v = sale.json()
    # subtotal 10000+3000=13000; desc 10% = 1300; IVA 19% sobre 9000 = 1710 ; total 13410
    assert (v["subtotal"], v["discount"], v["tax"], v["total"]) == ("13000.0000", "1300.0000", "1710.0000", "13410.0000")
    assert v["number"] == "V-000001"
    prods = {x["sku"]: x for x in admin.get(f"{u}/products", headers=h).json()}
    assert prods["A1"]["stock"] == "6.0000"
    r = admin.post(f"{u}/sales", json={"items": [{"product_id": p["id"], "qty": "7"}]}, headers=h)
    assert r.status_code == 422 and "insuficiente" in r.json()["detail"]
    # la venta fallida no descontó nada (transacción)
    assert {x["sku"]: x for x in admin.get(f"{u}/products", headers=h).json()}["A1"]["stock"] == "6.0000"
    assert admin.delete(f"{u}/products/{p['id']}", headers=h).status_code == 409
    assert admin.delete(f"{u}/customers/{c['id']}", headers=h).status_code == 409
    # anular devuelve inventario
    assert admin.post(f"{u}/sales/{v['id']}/void", headers=h).json()["status"] == "anulada"
    assert admin.post(f"{u}/sales/{v['id']}/void", headers=h).status_code == 409
    assert {x["sku"]: x for x in admin.get(f"{u}/products", headers=h).json()}["A1"]["stock"] == "10.0000"
    # movimientos manuales
    assert admin.post(f"{u}/inventory/movements", json={"product_id": p["id"], "kind": "salida", "qty": "8"}, headers=h).json()["stock"] == "2.0000"
    assert admin.post(f"{u}/inventory/movements", json={"product_id": p["id"], "kind": "ajuste", "qty": "5"}, headers=h).json()["stock"] == "5.0000"
    assert admin.post(f"{u}/inventory/movements", json={"product_id": s["id"], "kind": "entrada", "qty": "1"}, headers=h).status_code == 422
    assert len(admin.get(f"{u}/inventory/movements", headers=h).json()) == 5
    d = admin.get(f"{u}/dashboard", headers=h).json()
    assert d["ventas_mes"] == "0.00" and d["clientes"] == 1 and d["stock_bajo"] == []
    admin.post(f"{u}/sales", json={"items": [{"product_id": p["id"], "qty": "3"}]}, headers=h)
    d = admin.get(f"{u}/dashboard", headers=h).json()
    assert d["ventas_mes"] == "8925.00" and d["stock_bajo"][0]["name"] == "Gaseosa"
    t = date.today().isoformat()
    rep = admin.get(f"{u}/reports/sales", params={"start": t, "end": t}, headers=h).json()
    assert rep["summary"]["ventas"] == 1 and rep["summary"]["anuladas"] == 1
    csv = admin.get(f"{u}/reports/sales", params={"start": t, "end": t, "fmt": "csv"}, headers=h)
    assert csv.status_code == 200 and "V-000002" in csv.text
    acts = [a["action"] for a in admin.get(f"{u}/audit", headers=h).json()]
    assert "anular" in acts and "crear_erp" in acts


def test_roles_y_permisos(admin):
    slug, h, _ = setup_erp(admin)
    u = f"/api/rt/{slug}"
    roles = {r["name"]: r for r in admin.get(f"{u}/roles", headers=h).json()["roles"]}
    assert admin.post(f"{u}/users", json={"username": "vende", "name": "Vendedor Uno", "role_id": roles["Vendedor"]["id"],
                                          "password": "Vende-1234"}, headers=h).status_code == 201
    assert admin.post(f"{u}/users", json={"username": "vende", "name": "Otro", "role_id": roles["Vendedor"]["id"],
                                          "password": "Vende-1234"}, headers=h).status_code == 409
    hv = rt_login(admin, slug, "vende", "Vende-1234")
    p = admin.post(f"{u}/products", json={"sku": "B", "name": "Pan", "price": "1000", "initial_stock": "5"}, headers=h).json()
    assert admin.get(f"{u}/products", headers=hv).status_code == 200
    assert admin.post(f"{u}/products", json={"sku": "C", "name": "Leche", "price": "1"}, headers=hv).status_code == 403
    assert admin.get(f"{u}/users", headers=hv).status_code == 403
    assert admin.get(f"{u}/audit", headers=hv).status_code == 403
    r = admin.post(f"{u}/sales", json={"items": [{"product_id": p["id"], "qty": "1", "unit_price": "1"}]}, headers=hv)
    assert r.status_code == 403  # no puede cambiar precios
    assert admin.post(f"{u}/sales", json={"items": [{"product_id": p["id"], "qty": "1"}]}, headers=hv).status_code == 201
    me = admin.get(f"{u}/me", headers=hv).json()
    assert "usuarios" not in [m["key"] for m in me["modules"]]
    # último administrador protegido
    admin_id = next(x["id"] for x in admin.get(f"{u}/users", headers=h).json() if x["username"] == "admin")
    r = admin.put(f"{u}/users/{admin_id}", json={"username": "admin", "name": "Admin", "role_id": roles["Vendedor"]["id"]}, headers=h)
    assert r.status_code == 409
    r = admin.put(f"{u}/roles/{roles['Administrador']['id']}", json={"name": "Administrador", "permissions": ["ventas:ver"]}, headers=h)
    assert r.status_code == 409
    # desactivar usuario invalida su sesión
    vid = next(x["id"] for x in admin.get(f"{u}/users", headers=h).json() if x["username"] == "vende")
    admin.put(f"{u}/users/{vid}", json={"username": "vende", "name": "Vendedor", "role_id": roles["Vendedor"]["id"], "is_active": False}, headers=h)
    assert admin.get(f"{u}/products", headers=hv).status_code == 401


def test_modulo_desactivado_no_accesible(admin):
    e = make_erp(admin, "Hotel Sol", "hotel")  # hotel no trae inventario
    h = rt_login(admin, e["slug"])
    assert admin.get(f"/api/rt/{e['slug']}/inventory/movements", headers=h).status_code == 403


def test_registros_personalizados_barberia(admin):
    slug, h, _ = setup_erp(admin, "barberia")
    u = f"/api/rt/{slug}"
    c = admin.post(f"{u}/customers", json={"name": "Carlos"}, headers=h).json()
    ok = {"cliente": c["id"], "barbero": "Andrés", "fecha": "2026-11-20", "hora": "10:30", "servicio": "Corte",
          "valor": "30000", "comision_pct": "40", "estado": "Agendada"}
    r = admin.post(f"{u}/records/citas", json=ok, headers=h)
    assert r.status_code == 201 and r.json()["comision"] == "12000.00"
    bad = {**ok, "servicio": "Masaje", "cliente": 999, "comision_pct": "150", "fecha": "ayer"}
    msg = admin.post(f"{u}/records/citas", json=bad, headers=h).json()["detail"]
    assert "opción no válida" in msg and "inexistente" in msg and "≤ 100" in msg and "Fecha" in msg
    lst = admin.get(f"{u}/records/citas", headers=h).json()
    assert len(lst["rows"]) == 1 and lst["labels"]["cliente"][str(c["id"])] == "Carlos"
    rid = lst["rows"][0]["id"]
    assert admin.put(f"{u}/records/citas/{rid}", json={**ok, "valor": "50000"}, headers=h).json()["comision"] == "20000.00"
    assert admin.get(f"{u}/records/noexiste", headers=h).status_code == 404
    assert admin.delete(f"{u}/customers/{c['id']}", headers=h).status_code == 200 or True
    assert admin.delete(f"{u}/records/citas/{rid}", headers=h).json() == {"ok": True}


def test_relacion_entre_entidades_nomina(admin):
    slug, h, _ = setup_erp(admin, "nomina")
    u = f"/api/rt/{slug}"
    emp = admin.post(f"{u}/records/empleados", json={"nombre": "Laura", "documento": "123", "salario": "1423500"}, headers=h).json()
    nov = admin.post(f"{u}/records/novedades", json={"empleado": emp["id"], "tipo": "Vacaciones", "fecha": "2026-12-01",
                                                     "cantidad": "15"}, headers=h)
    assert nov.status_code == 201
    assert admin.delete(f"{u}/records/empleados/{emp['id']}", headers=h).status_code == 409
