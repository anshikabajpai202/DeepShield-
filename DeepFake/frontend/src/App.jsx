import { useState, useRef, useCallback } from 'react'

// ── Verdict config ───────────────────────────────────────────
const VERDICT_CONFIG = {
  FAKE:      { color: '#ef4444', bg: 'rgba(239,68,68,0.06)',  border: '#ef4444', emoji: '🚨', label: 'DEEPFAKE DETECTED' },
  REAL:      { color: '#22c55e', bg: 'rgba(34,197,94,0.06)',  border: '#22c55e', emoji: '✅', label: 'REAL IMAGE'         },
  UNCERTAIN: { color: '#f59e0b', bg: 'rgba(245,158,11,0.06)', border: '#f59e0b', emoji: '⚠️', label: 'UNCERTAIN'          },
}

// ── Upload Zone ──────────────────────────────────────────────
function UploadZone({ onFile, disabled }) {
  const inputRef  = useRef()
  const [dragging, setDragging] = useState(false)

  const handleDrop = useCallback((e) => {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file && file.type.startsWith('image/')) onFile(file)
  }, [onFile])

  const handleDrag = useCallback((e) => {
    e.preventDefault()
    setDragging(e.type === 'dragenter' || e.type === 'dragover')
  }, [])

  const handleInput = (e) => {
    const file = e.target.files[0]
    if (file) onFile(file)
  }

  return (
    <div
      className={`upload-zone ${dragging ? 'dragging' : ''} ${disabled ? 'disabled' : ''}`}
      onClick={() => !disabled && inputRef.current.click()}
      onDrop={handleDrop}
      onDragEnter={handleDrag}
      onDragOver={handleDrag}
      onDragLeave={handleDrag}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && inputRef.current.click()}
      aria-label="Upload image for deepfake detection"
    >
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        onChange={handleInput}
        style={{ display: 'none' }}
      />
      <div className="upload-icon">🛡️</div>
      <div className="upload-title">Drop your image here</div>
      <div className="upload-sub">or click to browse · JPG, PNG, WEBP, BMP</div>
      <div className="upload-hint">Real photo? Deepfake? GAN face? Find out.</div>
    </div>
  )
}

// ── Confidence Bar ───────────────────────────────────────────
function ConfBar({ label, value, color, right }) {
  return (
    <div className="conf-row">
      <span className="conf-label">{label}</span>
      <div className="conf-track">
        <div
          className="conf-fill"
          style={{ width: `${(value * 100).toFixed(1)}%`, background: right ? '#334155' : color }}
        />
      </div>
      <span className="conf-pct" style={{ color: right ? undefined : color }}>
        {(value * 100).toFixed(1)}%
      </span>
    </div>
  )
}

// ── Model Card ───────────────────────────────────────────────
function ModelCard({ result }) {
  const isFake = result.vote === 'FAKE'
  return (
    <div className="model-card" style={{ borderLeftColor: result.color }}>
      <div className="model-card-top">
        <div>
          <div className="model-name" style={{ color: result.color }}>{result.name}</div>
          <div className="model-arch">{result.arch}</div>
        </div>
        <div className="model-vote" style={{ color: isFake ? '#ef4444' : '#22c55e' }}>
          {result.vote}
        </div>
      </div>
      <ConfBar label="FAKE" value={result.fake} color={result.color} />
      <ConfBar label="REAL" value={result.real} color={result.color} right />
      <div className="model-note">{result.note}</div>
    </div>
  )
}

// ── Verdict Banner ───────────────────────────────────────────
function VerdictBanner({ data }) {
  const cfg = VERDICT_CONFIG[data.verdict]
  return (
    <div className="verdict-banner" style={{ background: cfg.bg, borderColor: cfg.border }}>
      <div className="verdict-emoji">{cfg.emoji}</div>
      <div className="verdict-label" style={{ color: cfg.color }}>{cfg.label}</div>
      <div className="verdict-sub">
        {data.fake_votes} model{data.fake_votes !== 1 ? 's' : ''} voted FAKE ·{' '}
        {data.real_votes} voted REAL
        {data.verdict === 'UNCERTAIN' && ' · Models disagree — result is inconclusive'}
      </div>
    </div>
  )
}

// ── Image Info Card ──────────────────────────────────────────
function ImageInfo({ file, data }) {
  return (
    <div className="info-card">
      <div className="info-row">
        <span className="info-key">File</span>
        <span className="info-val">{file.name}</span>
      </div>
      <div className="info-row">
        <span className="info-key">Size</span>
        <span className="info-val">{data.image_width} × {data.image_height}px</span>
      </div>
      <div className="info-row">
        <span className="info-key">Faces</span>
        <span className="info-val" style={{ color: data.face_count > 0 ? '#22c55e' : '#f59e0b' }}>
          {data.face_count > 0 ? `${data.face_count} detected` : 'None found'}
        </span>
      </div>
      <div className="info-row">
        <span className="info-key">EXIF</span>
        <span className="info-val" style={{ color: data.has_exif ? '#22c55e' : '#f59e0b' }}>
          {data.has_exif
            ? `${data.exif_count} fields — consistent with real camera`
            : 'None — possible AI-generated image'}
        </span>
      </div>
    </div>
  )
}

// ── Main App ─────────────────────────────────────────────────
export default function App() {
  const [file,     setFile]     = useState(null)
  const [preview,  setPreview]  = useState(null)
  const [loading,  setLoading]  = useState(false)
  const [result,   setResult]   = useState(null)
  const [error,    setError]    = useState(null)
  const [progress, setProgress] = useState('')

  const PROGRESS_STEPS = [
    'Detecting faces…',
    'Running Haywoodsloan…',
    'Running Organika…',
    'Running Wvolf…',
    'Running PrithivMLmods…',
    'Running Heem2…',
    'Counting votes…',
  ]

  const handleFile = (f) => {
    setFile(f)
    setResult(null)
    setError(null)
    const reader = new FileReader()
    reader.onload = (e) => setPreview(e.target.result)
    reader.readAsDataURL(f)
  }

  const handleReset = () => {
    setFile(null)
    setPreview(null)
    setResult(null)
    setError(null)
  }

  const handleAnalyze = async () => {
    if (!file) return
    setLoading(true)
    setError(null)
    setResult(null)

    // Cycle through progress messages while waiting
    let step = 0
    setProgress(PROGRESS_STEPS[0])
    const timer = setInterval(() => {
      step = (step + 1) % PROGRESS_STEPS.length
      setProgress(PROGRESS_STEPS[step])
    }, 900)

    try {
      const form = new FormData()
      form.append('file', file)

      const res = await fetch('/predict', { method: 'POST', body: form })

      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.detail || `Server error ${res.status}`)
      }

      const data = await res.json()
      setResult(data)
    } catch (err) {
      setError(err.message || 'Could not reach the backend. Is it running?')
    } finally {
      clearInterval(timer)
      setLoading(false)
      setProgress('')
    }
  }

  return (
    <div className="app">
      {/* ── Header ── */}
      <header className="header">
        <div className="header-inner">
          <div className="brand">
            <span className="brand-icon">🛡️</span>
            <span className="brand-name">DeepShield</span>
          </div>
          <div className="header-tag">5-Model Ensemble · Majority Vote</div>
        </div>
      </header>

      <main className="main">
        {/* ── Upload section ── */}
        {!preview && (
          <section className="section-upload">
            <h1 className="hero-title">Is it real or fake?</h1>
            <p className="hero-sub">
              Five specialized AI models analyze your image and vote.
              Three or more in agreement decides the verdict.
            </p>
            <UploadZone onFile={handleFile} disabled={loading} />

            {/* Model pills */}
            <div className="model-pills">
              {['Haywoodsloan', 'Organika', 'Wvolf', 'PrithivMLmods v2', 'Heem2'].map((name, i) => (
                <span key={name} className="model-pill" style={{
                  borderColor: ['#38bdf8','#818cf8','#e879f9','#34d399','#fb923c'][i]
                }}>
                  {name}
                </span>
              ))}
            </div>
          </section>
        )}

        {/* ── Analysis section ── */}
        {preview && (
          <section className="section-analysis">
            {/* Image preview + info */}
            <div className="preview-row">
              <div className="preview-img-wrap">
                <img src={preview} alt="Uploaded" className="preview-img" />
                {result && (
                  <div
                    className="preview-badge"
                    style={{ background: VERDICT_CONFIG[result.verdict].color }}
                  >
                    {VERDICT_CONFIG[result.verdict].emoji} {result.verdict}
                  </div>
                )}
              </div>

              <div className="preview-side">
                {result && <ImageInfo file={file} data={result} />}
                {!result && !loading && (
                  <div className="preview-placeholder">
                    <div className="placeholder-text">Ready to analyze</div>
                    <div className="placeholder-sub">{file?.name}</div>
                  </div>
                )}
                {loading && (
                  <div className="loading-box">
                    <div className="spinner" />
                    <div className="loading-text">{progress}</div>
                  </div>
                )}

                <div className="preview-actions">
                  <button
                    className="btn-analyze"
                    onClick={handleAnalyze}
                    disabled={loading || !!result}
                  >
                    {loading ? 'Analyzing…' : result ? 'Analysis complete' : '🔍 Run Analysis'}
                  </button>
                  <button className="btn-reset" onClick={handleReset}>
                    ↩ Try another image
                  </button>
                </div>
              </div>
            </div>

            {/* Error */}
            {error && (
              <div className="error-box">
                <strong>Error:</strong> {error}
                <div style={{ marginTop: 6, fontSize: '0.8rem', opacity: 0.7 }}>
                  Make sure the backend is running: <code>uvicorn backend:app --reload</code>
                </div>
              </div>
            )}

            {/* Verdict banner */}
            {result && <VerdictBanner data={result} />}

            {/* Model cards grid */}
            {result && (
              <>
                <div className="sec-label">Per-model breakdown</div>
                <div className="models-grid">
                  {result.model_results.map((r) => (
                    <ModelCard key={r.name} result={r} />
                  ))}
                </div>

                {/* EXIF signal */}
                <div className="sec-label">Forensic signal — EXIF metadata</div>
                <div
                  className="exif-card"
                  style={{ borderColor: result.has_exif ? '#15803d' : '#b45309' }}
                >
                  <div
                    className="exif-status"
                    style={{ color: result.has_exif ? '#22c55e' : '#f59e0b' }}
                  >
                    {result.has_exif
                      ? `✓ EXIF data present — ${result.exif_count} fields`
                      : '⚠️ No EXIF data found'}
                  </div>
                  <div className="exif-desc">
                    {result.has_exif
                      ? 'Real camera photos embed metadata (device, timestamp, GPS). The presence of EXIF is a positive signal for authenticity — though it can be stripped or spoofed.'
                      : 'AI-generated images have no embedded metadata by default. Missing EXIF is not conclusive proof of fakery (social platforms strip EXIF on upload), but it is a noteworthy forensic signal.'}
                  </div>
                </div>
              </>
            )}
          </section>
        )}
      </main>

      <footer className="footer">
        DEEPSHIELD · 5-MODEL ENSEMBLE · FOR RESEARCH & EDUCATION ONLY
      </footer>
    </div>
  )
}
