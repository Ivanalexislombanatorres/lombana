import {
  Armchair, Banknote, Bed, Boxes, Briefcase, Building2, Bus, ChartBar, Factory, Gauge, History, IdCard, Package,
  Plane, Receipt, Scissors, Shield, SlidersHorizontal, Stethoscope, Store, Table2, Truck, Users, Utensils, type LucideIcon,
} from 'lucide-react'

const MAP: Record<string, LucideIcon> = {
  scissors: Scissors, utensils: Utensils, store: Store, truck: Truck, briefcase: Briefcase, factory: Factory,
  stethoscope: Stethoscope, bed: Bed, plane: Plane, bus: Bus, id: IdCard, sliders: SlidersHorizontal,
  gauge: Gauge, users: Users, package: Package, receipt: Receipt, boxes: Boxes, table: Table2, chart: ChartBar,
  shield: Shield, history: History, building: Building2, wallet: Banknote, box: Armchair,
}

export function Icon({ name, className = 'h-5 w-5' }: { name: string; className?: string }) {
  const C = MAP[name] ?? Package
  return <C className={className} />
}

export function Logo({ size = 40 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-label="LOMBANA ESTUDIOS">
      <defs><linearGradient id="lg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#F7E08A" /><stop offset=".5" stopColor="#D4A93A" /><stop offset="1" stopColor="#8E6A17" /></linearGradient></defs>
      <path d="M8 10h10v32h16v10H8z" fill="url(#lg)" />
      <path d="M26 10h28v9H37v6h14v9H37v8h17v10H26z" fill="url(#lg)" opacity=".92" />
    </svg>
  )
}
