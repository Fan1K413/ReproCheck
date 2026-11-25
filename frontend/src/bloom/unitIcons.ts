import {
  ClipboardList,
  Database,
  FileText,
  Network,
  Route,
  ScrollText,
  Server,
  ShieldCheck,
  Terminal,
  Users,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { BloomUnitId } from './types'

export const UNIT_ICONS: Record<BloomUnitId, LucideIcon> = {
  materials: FileText,
  dataset: Database,
  facts: ClipboardList,
  evidence: Network,
  plan: Route,
  environment: Server,
  runs: Terminal,
  verification: ShieldCheck,
  report: ScrollText,
  team: Users,
}
