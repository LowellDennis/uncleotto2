import './Footer.css'

const APP_VERSION = '26.0102.1700' // YY.MMDD.HHmm format

export function Footer() {
  return (
    <footer className="app-footer">
      <div className="footer-divider"></div>
      <div className="footer-content">
        <span>Copyright &copy; Cyberclops LLC</span>
        <span>Version {APP_VERSION}</span>
      </div>
    </footer>
  )
}
