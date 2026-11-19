import { Navigate, Route, Routes } from 'react-router-dom'
import { tokens } from './lib/api'
import FactoryLayout from './factory/Layout'
import Login from './factory/Login'
import Dashboard from './factory/Dashboard'
import Builder from './factory/Builder'
import ErpList from './factory/ErpList'
import ErpDetail from './factory/ErpDetail'
import Sectors from './factory/Sectors'
import BrandEditor from './factory/BrandEditor'
import AiGateway from './factory/AiGateway'
import Agents from './factory/Agents'
import Formulas from './factory/Formulas'
import Databases from './factory/Databases'
import Clients from './factory/Clients'
import AuditPage from './factory/AuditPage'
import SettingsPage from './factory/SettingsPage'
import RuntimeApp from './runtime/RuntimeApp'

function Protected({ children }: { children: React.ReactNode }) {
  return tokens.factory() ? <>{children}</> : <Navigate to="/login" replace />
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/erp/:slug/*" element={<RuntimeApp />} />
      <Route element={<Protected><FactoryLayout /></Protected>}>
        <Route index element={<Dashboard />} />
        <Route path="constructor" element={<Builder />} />
        <Route path="erps" element={<ErpList />} />
        <Route path="erps/:id" element={<ErpDetail />} />
        <Route path="sectores" element={<Sectors />} />
        <Route path="marca" element={<BrandEditor />} />
        <Route path="agentes" element={<Agents />} />
        <Route path="ia" element={<AiGateway />} />
        <Route path="formulas" element={<Formulas />} />
        <Route path="bases" element={<Databases />} />
        <Route path="clientes" element={<Clients />} />
        <Route path="auditoria" element={<AuditPage />} />
        <Route path="configuracion" element={<SettingsPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
