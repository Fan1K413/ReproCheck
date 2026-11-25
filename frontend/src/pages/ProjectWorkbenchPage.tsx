import { Link, useParams, useSearchParams } from 'react-router-dom'
import { Sprout } from 'lucide-react'
import { useBloomUnits } from '../bloom/useBloomUnits'
import { BloomWorkbench } from '../bloom/BloomWorkbench'
import { BloomAtelier } from '../bloom/BloomAtelier'
import { EvidenceLoom } from '../bloom/EvidenceLoom'
import '../bloom/bloom.css'

export function ProjectWorkbenchPage() {
  const { projectId = '' } = useParams()
  const [searchParams] = useSearchParams()
  const view = searchParams.get('view')
  const data = useBloomUnits(projectId)

  if (!data.stageReady) {
    return (
      <div className="bloom-page">
        <div className="bloom-boot">
          <span className="bloom-boot__mark">
            <Sprout size={20} />
          </span>
          正在读取项目账本…
        </div>
      </div>
    )
  }

  if (!data.project) {
    return (
      <div className="bloom-page">
        <div className="bloom-boot">
          <span className="bloom-boot__mark">
            <Sprout size={20} />
          </span>
          <strong>项目不存在或当前账户无权访问</strong>
          <span style={{ fontSize: 12, opacity: 0.6 }}>
            项目 ID：{projectId}
          </span>
          <Link className="bloom-link-out" to="/projects" style={{ marginTop: 8 }}>
            返回项目列表
          </Link>
        </div>
      </div>
    )
  }

  if (view === 'atelier') {
    return <BloomAtelier projectId={projectId} data={data} />
  }
  if (view === 'loom') {
    return <EvidenceLoom data={data} />
  }
  return <BloomWorkbench projectId={projectId} data={data} />
}
