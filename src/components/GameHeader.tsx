import './GameHeader.css'

export function GameHeader() {
  return (
    <div className="game-header">
      <img src="/UncleOtto.jpg" alt="Uncle Otto" className="uncle-otto-image" />
      <div className="game-title">
        <div>Uncle Otto</div>
        <div>splashes happily</div>
        <div>in the bathtub</div>
      </div>
    </div>
  )
}
