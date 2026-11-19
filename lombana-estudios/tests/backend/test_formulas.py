from decimal import Decimal
import pytest
from app.formulas.engine import FormulaError, evaluate, validate, variables_of


def test_aritmetica_decimal_exacta():
    assert evaluate("0.1 + 0.2", {}) == Decimal("0.3")
    assert evaluate("precio * cantidad", {"precio": "19990.50", "cantidad": 3}) == Decimal("59971.50")


def test_funciones_empresariales():
    assert evaluate("IMPUESTO(100000, 19)", {}) == Decimal("19000")
    assert evaluate("CON_IMPUESTO(100, 19)", {}) == Decimal("119")
    assert evaluate("DESCUENTO(200, 10)", {}) == Decimal("180")
    assert evaluate("MARGEN(100, 60)", {}) == Decimal("40")
    assert evaluate("REDONDEAR(10 / 3, 2)", {}) == Decimal("3.33")
    assert evaluate("PROMEDIO(1, 2, 3, 4)", {}) == Decimal("2.5")
    assert evaluate("SI(total > 1000, DESCUENTO(total, 5), total)", {"total": 2000}) == Decimal("1900")
    assert evaluate("SI(total > 1000, 1 / 0, total)", {"total": 10}) == Decimal("10")  # SI es perezoso


@pytest.mark.parametrize("expr", [
    "__import__('os').system('dir')", "open('x')", "a.b", "[1,2]", "(lambda: 1)()", "'texto'",
    "x[0]", "SUMA(*a)", "eval('1')", "1 if True else 2 if __x else 3", "True",
])
def test_bloquea_codigo_arbitrario(expr):
    with pytest.raises(FormulaError):
        evaluate(expr, {"a": 1, "x": 1, "__x": 1})


def test_errores_controlados():
    with pytest.raises(FormulaError, match="cero"):
        evaluate("1 / 0", {})
    with pytest.raises(FormulaError, match="Falta"):
        evaluate("a + b", {"a": 1})
    with pytest.raises(FormulaError, match="exponentes"):
        evaluate("2 ** 1000", {})
    with pytest.raises(FormulaError):
        evaluate("9" * 400 + " * " + "9" * 90, {})
    with pytest.raises(FormulaError, match="no declaradas"):
        validate("a + b", ["a"])
    assert variables_of("SI(x > 1, y, z) + MAX(y, 2)") == ["x", "y", "z"]


def test_api_formulas(admin):
    r = admin.post("/api/formulas/test", json={"expression": "COMISION(ventas, pct)", "values": {"ventas": "1500000", "pct": 8}})
    assert r.json() == {"ok": True, "variables": ["pct", "ventas"], "result": "120000"}
    r = admin.post("/api/formulas/test", json={"expression": "import os", "values": {}})
    assert r.json()["ok"] is False
    body = {"code": "comision_barbero", "name": "Comisión", "expression": "COMISION(valor, pct)", "variables": ["valor", "pct"]}
    assert admin.post("/api/formulas", json=body).json()["version"] == 1
    assert admin.post("/api/formulas", json={**body, "expression": "COMISION(valor, pct) + 1"}).json()["version"] == 2
    assert len(admin.get("/api/formulas/comision_barbero/versions").json()) == 2
    assert admin.get("/api/formulas").json()[0]["version"] == 2
    assert admin.post("/api/formulas", json={**body, "variables": ["valor"]}).status_code == 422
