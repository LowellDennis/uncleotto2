import './Footer.css'

const APP_VERSION = '2026.0103.2258' // YYYY.MMDD.HHmm format

export function Footer() {
  return (
    <footer className="app-footer">
      <div className="footer-divider"></div>
      <div className="footer-content">
        <span>Copyright &copy; Cyberclops LLC</span>
        <span>V {APP_VERSION}</span>
      </div>
    </footer>
  )
}
