import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import FirstRunExperience, { onboardingStatus } from '../ux/FirstRunExperience'
import RadialWorkbench from './RadialWorkbench'

/** L1 一级工作台：全屏、无侧栏、不滚动。首次登录先走任务式引导。 */
export default function WorkbenchPage() {
  const [params] = useSearchParams()
  const requested = params.get('what') === '1'
  const [guideOpen, setGuideOpen] = useState(() => requested || onboardingStatus() === null)
  const [reopened, setReopened] = useState(() => requested || onboardingStatus() !== null)

  useEffect(() => {
    const root = document.documentElement
    root.classList.add('rc-no-scroll')
    return () => root.classList.remove('rc-no-scroll')
  }, [])

  useEffect(() => {
    const reopen = () => {
      setReopened(onboardingStatus() !== null)
      setGuideOpen(true)
    }
    window.addEventListener('rc:open-what-to-do', reopen)
    return () => window.removeEventListener('rc:open-what-to-do', reopen)
  }, [])

  if (guideOpen) {
    return (
      <FirstRunExperience
        initialStage={reopened ? 'goals' : 'welcome'}
        onFinish={() => {
          setReopened(false)
          setGuideOpen(false)
        }}
      />
    )
  }

  return (
    <RadialWorkbench
      onReopenGuide={() => {
        setReopened(true)
        setGuideOpen(true)
      }}
    />
  )
}
