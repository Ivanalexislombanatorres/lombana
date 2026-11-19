"""Motor de fórmulas empresariales.

Intérprete de expresiones RESTRINGIDO: analiza la fórmula con `ast` y solo
permite nodos y funciones de una lista blanca. Nunca usa eval/exec.
Todos los números se convierten a Decimal (precisión monetaria).

Ejemplos:
    precio * cantidad
    SI(total > 1000000, DESCUENTO(total, 5), total)
    REDONDEAR(IMPUESTO(subtotal, 19), 2)
    MARGEN(precio, costo)
"""
from __future__ import annotations

import ast
from decimal import ROUND_HALF_UP, Decimal, DivisionByZero, InvalidOperation, localcontext

MAX_LEN = 500
MAX_NODES = 200
MAX_ABS = Decimal("1e15")
HUNDRED = Decimal(100)


class FormulaError(ValueError):
    pass


def _d(x) -> Decimal:
    if isinstance(x, bool):
        raise FormulaError("Se esperaba un número y se recibió un valor lógico")
    if isinstance(x, Decimal):
        return x
    if isinstance(x, (int, str)):
        try:
            return Decimal(str(x))
        except InvalidOperation:
            raise FormulaError(f"Valor numérico inválido: {x!r}") from None
    if isinstance(x, float):
        return Decimal(str(x))
    raise FormulaError(f"Tipo no soportado: {type(x).__name__}")


def _round(x, n=2):
    n = int(_d(n))
    if not 0 <= n <= 8:
        raise FormulaError("REDONDEAR admite entre 0 y 8 decimales")
    return _d(x).quantize(Decimal(1).scaleb(-n), rounding=ROUND_HALF_UP)


def _avg(*xs):
    if not xs:
        raise FormulaError("PROMEDIO necesita al menos un valor")
    return sum((_d(x) for x in xs), Decimal(0)) / len(xs)


def _si(cond, a, b):  # evaluación perezosa se maneja en el intérprete
    return a if cond else b


def _margen(precio, costo):
    p = _d(precio)
    if p == 0:
        raise FormulaError("MARGEN: el precio no puede ser cero")
    return (p - _d(costo)) / p * HUNDRED


def _rentabilidad(utilidad, inversion):
    i = _d(inversion)
    if i == 0:
        raise FormulaError("RENTABILIDAD: la inversión no puede ser cero")
    return _d(utilidad) / i * HUNDRED


FUNCTIONS = {
    "SI": (_si, "SI(condición, valor_si, valor_no)"),
    "SUMA": (lambda *xs: sum((_d(x) for x in xs), Decimal(0)), "SUMA(a, b, ...)"),
    "PROMEDIO": (_avg, "PROMEDIO(a, b, ...)"),
    "MIN": (lambda *xs: min(_d(x) for x in xs), "MIN(a, b, ...)"),
    "MAX": (lambda *xs: max(_d(x) for x in xs), "MAX(a, b, ...)"),
    "ABS": (lambda x: abs(_d(x)), "ABS(x)"),
    "REDONDEAR": (_round, "REDONDEAR(x, decimales)"),
    "PORCENTAJE": (lambda base, pct: _d(base) * _d(pct) / HUNDRED, "PORCENTAJE(base, %) → valor del %"),
    "IMPUESTO": (lambda base, tasa: _d(base) * _d(tasa) / HUNDRED, "IMPUESTO(base, tasa%) → valor del impuesto"),
    "CON_IMPUESTO": (lambda base, tasa: _d(base) * (1 + _d(tasa) / HUNDRED), "CON_IMPUESTO(base, tasa%) → base + impuesto"),
    "DESCUENTO": (lambda base, pct: _d(base) * (1 - _d(pct) / HUNDRED), "DESCUENTO(base, %) → base con descuento"),
    "COMISION": (lambda base, pct: _d(base) * _d(pct) / HUNDRED, "COMISION(ventas, %)"),
    "MARGEN": (_margen, "MARGEN(precio, costo) → % de margen"),
    "RENTABILIDAD": (_rentabilidad, "RENTABILIDAD(utilidad, inversión) → %"),
    "Y": (lambda *xs: all(xs), "Y(cond1, cond2, ...)"),
    "O": (lambda *xs: any(xs), "O(cond1, cond2, ...)"),
    "NO": (lambda x: not x, "NO(cond)"),
}

_BIN = {
    ast.Add: lambda a, b: _d(a) + _d(b),
    ast.Sub: lambda a, b: _d(a) - _d(b),
    ast.Mult: lambda a, b: _d(a) * _d(b),
    ast.Div: lambda a, b: _d(a) / _d(b),
    ast.Mod: lambda a, b: _d(a) % _d(b),
}
_CMP = {
    ast.Gt: lambda a, b: a > b, ast.GtE: lambda a, b: a >= b,
    ast.Lt: lambda a, b: a < b, ast.LtE: lambda a, b: a <= b,
    ast.Eq: lambda a, b: a == b, ast.NotEq: lambda a, b: a != b,
}
_ALLOWED = (ast.Expression, ast.BinOp, ast.UnaryOp, ast.Compare, ast.BoolOp, ast.Constant, ast.Name,
            ast.Call, ast.IfExp, ast.Load, ast.And, ast.Or, ast.Not, ast.USub, ast.UAdd, ast.Pow,
            *_BIN.keys(), *_CMP.keys())


def parse(expression: str) -> ast.Expression:
    if not isinstance(expression, str) or not expression.strip():
        raise FormulaError("La fórmula está vacía")
    if len(expression) > MAX_LEN:
        raise FormulaError(f"La fórmula supera {MAX_LEN} caracteres")
    try:
        tree = ast.parse(expression.strip(), mode="eval")
    except SyntaxError as e:
        raise FormulaError(f"Error de sintaxis en la posición {e.offset}: revisa paréntesis y operadores") from None
    nodes = list(ast.walk(tree))
    if len(nodes) > MAX_NODES:
        raise FormulaError("La fórmula es demasiado compleja")
    for n in nodes:
        if not isinstance(n, _ALLOWED):
            raise FormulaError(f"Elemento no permitido en fórmulas: {type(n).__name__}")
        if isinstance(n, ast.Call):
            if not isinstance(n.func, ast.Name) or n.func.id not in FUNCTIONS:
                name = getattr(n.func, "id", "?")
                raise FormulaError(f"Función no autorizada: {name}")
            if n.keywords:
                raise FormulaError("Las funciones no aceptan argumentos con nombre")
        if isinstance(n, ast.Constant) and not isinstance(n.value, (int, float)) or \
                isinstance(n, ast.Constant) and isinstance(n.value, bool):
            raise FormulaError("Solo se permiten constantes numéricas")
        if isinstance(n, ast.Name) and n.id.startswith("_"):
            raise FormulaError("Nombre de variable inválido")
    return tree


def variables_of(expression: str) -> list[str]:
    tree = parse(expression)
    called = {n.func.id for n in ast.walk(tree) if isinstance(n, ast.Call)}
    names = {n.id for n in ast.walk(tree) if isinstance(n, ast.Name)} - called
    return sorted(names)


def validate(expression: str, declared: list[str] | None = None) -> list[str]:
    used = variables_of(expression)
    if declared is not None:
        missing = [v for v in used if v not in declared]
        if missing:
            raise FormulaError(f"Variables no declaradas: {', '.join(missing)}")
    return used


def evaluate(expression: str, values: dict) -> Decimal | bool:
    tree = parse(expression)
    vals = {k: (_d(v) if not isinstance(v, bool) else v) for k, v in values.items()}

    def ev(n):
        if isinstance(n, ast.Expression):
            return ev(n.body)
        if isinstance(n, ast.Constant):
            return _d(n.value)
        if isinstance(n, ast.Name):
            if n.id not in vals:
                raise FormulaError(f"Falta el valor de la variable '{n.id}'")
            return vals[n.id]
        if isinstance(n, ast.UnaryOp):
            v = ev(n.operand)
            if isinstance(n.op, ast.Not):
                return not v
            return -_d(v) if isinstance(n.op, ast.USub) else _d(v)
        if isinstance(n, ast.BinOp):
            a, b = ev(n.left), ev(n.right)
            if isinstance(n.op, ast.Pow):
                exp = _d(b)
                if exp != exp.to_integral_value() or abs(exp) > 12:
                    raise FormulaError("Potencias: solo exponentes enteros entre -12 y 12")
                return _d(a) ** int(exp)
            return _BIN[type(n.op)](a, b)
        if isinstance(n, ast.Compare):
            left = ev(n.left)
            for op, comp in zip(n.ops, n.comparators):
                right = ev(comp)
                if not _CMP[type(op)](left, right):
                    return False
                left = right
            return True
        if isinstance(n, ast.BoolOp):
            if isinstance(n.op, ast.And):
                return all(bool(ev(v)) for v in n.values)
            return any(bool(ev(v)) for v in n.values)
        if isinstance(n, ast.IfExp):
            return ev(n.body) if ev(n.test) else ev(n.orelse)
        if isinstance(n, ast.Call):
            fname = n.func.id
            if fname == "SI":
                if len(n.args) != 3:
                    raise FormulaError("SI necesita 3 argumentos")
                return ev(n.args[1]) if ev(n.args[0]) else ev(n.args[2])
            fn = FUNCTIONS[fname][0]
            try:
                return fn(*[ev(a) for a in n.args])
            except TypeError:
                raise FormulaError(f"Número de argumentos incorrecto en {fname}. Uso: {FUNCTIONS[fname][1]}") from None
        raise FormulaError("Expresión no soportada")

    with localcontext() as ctx:
        ctx.prec = 28
        try:
            result = ev(tree)
        except (DivisionByZero, InvalidOperation, ZeroDivisionError):
            raise FormulaError("División por cero o operación inválida") from None
    if isinstance(result, Decimal) and abs(result) > MAX_ABS:
        raise FormulaError("El resultado excede el límite permitido")
    return result


def catalog() -> list[dict]:
    return [{"name": k, "usage": v[1]} for k, v in FUNCTIONS.items()]
