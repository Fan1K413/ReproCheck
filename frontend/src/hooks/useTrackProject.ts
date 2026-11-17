import { useEffect } from 'react'
import { useUIStore } from '../stores/uiStore'

/** 记录当前项目，供侧栏材料解析分组生成带项目 id 的真实链接。 */
export function useTrackProject(projectId: string | null | undefined): void {
  const setLastProjectId = useUIStore((state) => state.setLastProjectId)
  useEffect(() => {
    if (projectId) setLastProjectId(projectId)
  }, [projectId, setLastProjectId])
}
