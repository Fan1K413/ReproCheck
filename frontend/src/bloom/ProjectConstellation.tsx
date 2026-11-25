import type { CSSProperties } from 'react'
import { ArrowUpRight } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Icon } from '../components/Icon'
import type { Project } from '../types/api'
import { petalPolygon, polygonCss } from './geometry'

function seedFor(id: string): number {
  let hash = 0
  for (let index = 0; index < id.length; index += 1) {
    hash = (hash * 31 + id.charCodeAt(index)) >>> 0
  }
  return hash % 100000
}

/**
 * 首页项目星丛：每个项目是一片独立的纸瓣。
 * 数量保持 1–5，点击直接进入该项目的 Bloom 账本；不取代「查看全部」。
 */
export function ProjectConstellation({ projects }: { projects: Project[] }) {
  const visible = projects.slice(0, 5)

  if (visible.length === 0) {
    return (
      <div className="bloom-constellation">
        <p className="bloom-constellation__empty">
          尚无项目。创建第一个复现审计档案后，项目会以纸瓣的形式出现在这里。
        </p>
      </div>
    )
  }

  return (
    <div className="bloom-constellation">
      {visible.map((project, index) => {
        const seed = seedFor(project.id) + index * 137
        return (
          <Link
            key={project.id}
            to={`/projects/${project.id}/workbench`}
            className="bloom-constellation__card"
            aria-label={`进入 ${project.name} 的 Bloom 项目工作台`}
            style={{ textDecoration: 'none', '--pc-index': index } as CSSProperties}
          >
            <span
              className="bloom-constellation__paper"
              style={
                {
                  '--bloom-clip': polygonCss(petalPolygon(seed, 48, 1.035)),
                  transform: `rotate(${((index % 3) - 1) * 0.5}deg)`,
                } as CSSProperties
              }
            >
              <span className="bloom-constellation__domain">{project.domain || 'Research'}</span>
              <span className="bloom-constellation__name">{project.name}</span>
              <span className="bloom-constellation__paper-title">{project.paper_title}</span>
              <span className="bloom-constellation__foot">
                <span>
                  {new Date(project.created_at).getFullYear()} · {project.description ? '档案已建立' : '待补充描述'}
                </span>
                <span className="bloom-constellation__enter">
                  进入账本 <Icon as={ArrowUpRight} size={12} />
                </span>
              </span>
            </span>
          </Link>
        )
      })}
    </div>
  )
}
