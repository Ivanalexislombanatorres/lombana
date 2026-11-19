"""Genera templates/sectores/*.json (plantillas de sector). Se puede editar a mano después."""
import json, pathlib
OUT = pathlib.Path(__file__).resolve().parents[1] / "templates" / "sectores"
OUT.mkdir(parents=True, exist_ok=True)
BASE = ["dashboard", "clientes", "productos", "ventas", "reportes", "usuarios", "auditoria"]
def S(code, name, icon, desc, modules, labels=None, entities=None, kpis=None, colors=("#2563EB", "#0F172A"), op="mixta"):
    return {"code": code, "name": name, "icon": icon, "description": desc, "operation_type": op,
            "modules": modules, "labels": labels or {}, "entities": entities or [],
            "kpis": kpis or ["ventas_mes", "ticket_promedio", "clientes", "stock_bajo"],
            "branding": {"primary": colors[0], "secondary": colors[1], "button": colors[0]}}
F = lambda key, label, type="text", **kw: {"key": key, "label": label, "type": type, **kw}
T = [
 S("barberia", "Barbería y peluquería", "scissors", "Citas, servicios, barberos y ventas de productos.",
   BASE + ["registros", "inventario"], {"productos": "Servicios y productos", "clientes": "Clientes"},
   [{"key": "citas", "label": "Citas", "fields": [
       F("cliente", "Cliente", "relation", relation="customers", required=True),
       F("barbero", "Barbero", required=True), F("fecha", "Fecha", "date", required=True),
       F("hora", "Hora", required=True, max_length=5),
       F("servicio", "Servicio", "select", options=["Corte", "Barba", "Corte + barba", "Tinte", "Cejas"]),
       F("valor", "Valor", "money", min=0), F("comision_pct", "Comisión %", "number", min=0, max=100),
       F("comision", "Comisión barbero", "calculated", formula="COMISION(valor, comision_pct)"),
       F("estado", "Estado", "select", options=["Agendada", "Atendida", "Cancelada", "No asistió"])]}],
   colors=("#C9A227", "#111827"), op="servicios"),
 S("restaurante", "Restaurante y cafetería", "utensils", "Carta, pedidos, mesas e inventario de insumos.",
   BASE + ["inventario", "proveedores", "registros"], {"productos": "Carta e insumos"},
   [{"key": "mesas", "label": "Mesas", "fields": [F("numero", "Número", "number", required=True, min=1),
       F("capacidad", "Capacidad", "number", min=1), F("zona", "Zona", "select", options=["Salón", "Terraza", "Barra"]),
       F("estado", "Estado", "select", options=["Libre", "Ocupada", "Reservada"])]}], colors=("#DC2626", "#1C1917")),
 S("tienda", "Tienda y supermercado", "store", "Punto de venta, inventario y proveedores.",
   BASE + ["inventario", "proveedores"], colors=("#16A34A", "#052E16"), op="productos"),
 S("distribuidora", "Distribuidora", "truck", "Rutas, pedidos mayoristas, inventario y proveedores.",
   BASE + ["inventario", "proveedores", "registros"], {},
   [{"key": "rutas", "label": "Rutas", "fields": [F("nombre", "Ruta", required=True), F("conductor", "Conductor"),
       F("placa", "Placa", max_length=10), F("dia", "Día", "select", options=["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"])]}],
   colors=("#EA580C", "#1C1917"), op="productos"),
 S("comercial", "Empresa comercial", "briefcase", "Compra-venta, clientes, proveedores e inventario.",
   BASE + ["inventario", "proveedores"], colors=("#0EA5E9", "#0C1A2B"), op="productos"),
 S("industrial", "Empresa industrial", "factory", "Producción, materias primas e inventario.",
   BASE + ["inventario", "proveedores", "registros"], {"productos": "Productos y materias primas"},
   [{"key": "ordenes_produccion", "label": "Órdenes de producción", "fields": [
       F("producto", "Producto", "relation", relation="products", required=True), F("cantidad", "Cantidad", "number", min=0, required=True),
       F("costo_unitario", "Costo unitario", "money", min=0), F("costo_total", "Costo total", "calculated", formula="cantidad * costo_unitario"),
       F("fecha", "Fecha", "date"), F("estado", "Estado", "select", options=["Planificada", "En proceso", "Terminada"])]}],
   colors=("#64748B", "#0F172A"), op="productos"),
 S("clinica", "Clínica y centro de servicios", "stethoscope", "Agenda de citas, pacientes y servicios.",
   BASE + ["registros"], {"clientes": "Pacientes", "productos": "Servicios"},
   [{"key": "citas", "label": "Citas", "fields": [F("paciente", "Paciente", "relation", relation="customers", required=True),
       F("profesional", "Profesional", required=True), F("fecha", "Fecha", "date", required=True), F("hora", "Hora", max_length=5),
       F("estado", "Estado", "select", options=["Agendada", "Atendida", "Cancelada"])]}], colors=("#0D9488", "#042F2E"), op="servicios"),
 S("hotel", "Hotel", "bed", "Habitaciones, reservas y huéspedes.", BASE + ["registros"], {"clientes": "Huéspedes"},
   [{"key": "reservas", "label": "Reservas", "fields": [F("huesped", "Huésped", "relation", relation="customers", required=True),
       F("habitacion", "Habitación", required=True), F("entrada", "Entrada", "date", required=True), F("salida", "Salida", "date", required=True),
       F("noches", "Noches", "number", min=1), F("tarifa", "Tarifa por noche", "money", min=0),
       F("total", "Total", "calculated", formula="noches * tarifa"),
       F("estado", "Estado", "select", options=["Reservada", "Check-in", "Check-out", "Cancelada"])]}], colors=("#7C3AED", "#1E1B4B"), op="servicios"),
 S("turismo", "Agencia de turismo", "plane", "Paquetes, reservas y clientes.", BASE + ["registros"], {"productos": "Paquetes"},
   [{"key": "viajes", "label": "Viajes", "fields": [F("cliente", "Cliente", "relation", relation="customers", required=True),
       F("destino", "Destino", required=True), F("salida", "Salida", "date"), F("pasajeros", "Pasajeros", "number", min=1),
       F("valor", "Valor", "money", min=0)]}], colors=("#0284C7", "#082F49"), op="servicios"),
 S("transporte", "Empresa de transporte", "bus", "Vehículos, viajes y conductores.", BASE + ["registros"], {"productos": "Servicios de transporte"},
   [{"key": "viajes", "label": "Viajes", "fields": [F("placa", "Placa", required=True, max_length=10), F("conductor", "Conductor", required=True),
       F("origen", "Origen"), F("destino", "Destino"), F("fecha", "Fecha", "date"), F("km", "Kilómetros", "number", min=0),
       F("valor_km", "Valor por km", "money", min=0), F("valor", "Valor del viaje", "calculated", formula="km * valor_km")]}],
   colors=("#CA8A04", "#1C1917"), op="servicios"),
 S("servicios", "Servicios profesionales", "briefcase", "Proyectos, clientes y facturación de servicios.", BASE + ["registros"],
   {"productos": "Servicios"},
   [{"key": "proyectos", "label": "Proyectos", "fields": [F("cliente", "Cliente", "relation", relation="customers", required=True),
       F("nombre", "Proyecto", required=True), F("horas", "Horas", "number", min=0), F("tarifa_hora", "Tarifa por hora", "money", min=0),
       F("valor", "Valor", "calculated", formula="horas * tarifa_hora"),
       F("estado", "Estado", "select", options=["Propuesta", "En curso", "Terminado"])]}], colors=("#4F46E5", "#1E1B4B"), op="servicios"),
 S("nomina", "Nómina y gestión humana", "id", "Registro de empleados y novedades (la liquidación de nómina es una fase posterior).",
   ["dashboard", "registros", "reportes", "usuarios", "auditoria"], {},
   [{"key": "empleados", "label": "Empleados", "fields": [F("nombre", "Nombre", required=True), F("documento", "Documento", required=True),
       F("cargo", "Cargo"), F("ingreso", "Fecha de ingreso", "date"), F("salario", "Salario", "money", min=0),
       F("estado", "Estado", "select", options=["Activo", "Retirado"])]},
    {"key": "novedades", "label": "Novedades", "fields": [F("empleado", "Empleado", "relation", relation="empleados", required=True),
       F("tipo", "Tipo", "select", options=["Horas extra", "Incapacidad", "Vacaciones", "Licencia", "Permiso"]),
       F("fecha", "Fecha", "date", required=True), F("cantidad", "Cantidad (horas/días)", "number", min=0)]}],
   kpis=["registros"], colors=("#059669", "#022C22"), op="servicios"),
 S("personalizado", "Personalizado", "sliders", "Empieza desde cero y diseña tus propios módulos y entidades.",
   ["dashboard", "usuarios", "auditoria"], colors=("#2563EB", "#0F172A")),
]
SHORT = {"barberia": "Barbería", "restaurante": "Restaurante", "tienda": "Tienda", "distribuidora": "Distribuidora",
         "comercial": "Comercial", "industrial": "Industrial", "clinica": "Clínica", "hotel": "Hotel", "turismo": "Turismo",
         "transporte": "Transporte", "servicios": "Servicios", "nomina": "Nómina", "personalizado": "Personalizado"}
ORDER = list(SHORT)
for i, t in enumerate(T):
    t["short"] = SHORT[t["code"]]
    t["order"] = ORDER.index(t["code"])
for t in T:
    (OUT / f"{t['code']}.json").write_text(json.dumps(t, ensure_ascii=False, indent=2), encoding="utf-8")
print(len(T), "plantillas")
