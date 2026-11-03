import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Disclaimer, EstadoBadge } from './ui'
import { Footprints } from './Footprints'

describe('componentes', () => {
  it('el estado no depende solo del color (icono + palabra)', () => {
    render(<EstadoBadge estado="no" />)
    expect(screen.getByText('A corregir')).toBeTruthy()
  })
  it('muestra el aviso médico', () => {
    render(<Disclaimer text="Herramienta educativa de técnica; no es un diagnóstico médico." />)
    expect(screen.getByTestId('aviso-medico').textContent).toContain('no es un diagnóstico médico')
  })
  it('mapa de plantillas con orden de apoyo', () => {
    render(<Footprints static={[1, 2, 1, 2]} ordenMs={8} />)
    expect(screen.getByText('antepié → talón')).toBeTruthy()
  })
})
