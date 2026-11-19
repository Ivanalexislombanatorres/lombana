export type Branding = {
  software_name: string; company_name: string; slogan: string; logo: string | null; favicon: string | null; login_image: string | null
  primary: string; secondary: string; button: string; background: string; surface: string; text: string; font: string
  theme: 'claro' | 'oscuro'; welcome_title: string; welcome_text: string; contact_email: string; contact_phone: string
  contact_address: string; document_footer: string; invoice_template: 'clasica' | 'moderna' | 'minimal'
}
export type FieldDef = {
  key: string; label: string; type: 'text' | 'number' | 'money' | 'date' | 'select' | 'checkbox' | 'relation' | 'calculated'
  required?: boolean; options?: string[]; relation?: string | null; formula?: string | null; min?: number | null; max?: number | null; max_length?: number | null
}
export type EntityDef = { key: string; label: string; fields: FieldDef[] }
export type ModuleCfg = { key: string; enabled: boolean; label: string; order: number }
export type Company = { name: string; sector: string; activity: string; size: string; country: string; currency: string; language: string; timezone: string; operation_type: string }
export type ErpConfig = { company: Company; modules: ModuleCfg[]; entities: EntityDef[]; kpis: string[] }
export type Erp = {
  id: number; slug: string; name: string; sector: string; status: string; db_name: string; db_engine: string; client_id: number | null
  client_name: string | null; current_version: number; published_version: number | null; software_name: string; primary: string
  modules: string[]; created_at: string; updated_at: string; config?: ErpConfig; branding?: Branding
}
export type Sector = { code: string; name: string; icon: string; description: string; modules: string[]; labels: Record<string, string>; entities: EntityDef[]; branding: Partial<Branding> }
export type ModuleDef = { key: string; name: string; icon: string; operational: boolean; core?: boolean; depends?: string[] }
