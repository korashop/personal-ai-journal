import { ChevronLeft, ChevronRight, FileText, ImagePlus, LoaderCircle, Sparkles, Trash2 } from 'lucide-react'
import { useRef, useState } from 'react'
import type { DragEvent, FormEvent } from 'react'

import { transcribePhotos } from '../lib/api'
import type { EntrySource } from '../types'

type EntryComposerProps = {
  busy: boolean
  onSubmit: (payload: { rawText: string; source: EntrySource; photos: File[]; transcribedText?: string }) => Promise<void>
}

export function EntryComposer({ busy, onSubmit }: EntryComposerProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [rawText, setRawText] = useState('')
  const [source, setSource] = useState<EntrySource>('typed')
  const [photos, setPhotos] = useState<File[]>([])
  const [transcribedText, setTranscribedText] = useState('')
  const [reviewReady, setReviewReady] = useState(false)
  const [reviewBusy, setReviewBusy] = useState(false)
  const [reviewError, setReviewError] = useState<string | null>(null)
  const [reviewMeta, setReviewMeta] = useState<{ imageCount: number; failedCount: number } | null>(null)
  const [dragActive, setDragActive] = useState(false)

  function appendPhotos(nextFiles: File[]) {
    setPhotos((current) => {
      const seen = new Set(current.map((photo) => `${photo.name}-${photo.lastModified}-${photo.size}`))
      const merged = [...current]

      for (const file of nextFiles) {
        const key = `${file.name}-${file.lastModified}-${file.size}`
        if (!seen.has(key)) {
          seen.add(key)
          merged.push(file)
        }
      }

      return merged
    })
    setReviewReady(false)
    setTranscribedText('')
    setReviewError(null)
    setReviewMeta(null)
  }

  function movePhoto(index: number, direction: -1 | 1) {
    setPhotos((current) => {
      const nextIndex = index + direction
      if (nextIndex < 0 || nextIndex >= current.length) return current
      const next = [...current]
      ;[next[index], next[nextIndex]] = [next[nextIndex], next[index]]
      return next
    })
    setReviewReady(false)
    setTranscribedText('')
    setReviewError(null)
    setReviewMeta(null)
  }

  function removePhoto(target: File) {
    setPhotos((current) =>
      current.filter((item) => `${item.name}-${item.lastModified}` !== `${target.name}-${target.lastModified}`),
    )
    setReviewReady(false)
    setTranscribedText('')
    setReviewError(null)
    setReviewMeta(null)
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!rawText.trim() && photos.length === 0) {
      return
    }

    await onSubmit({
      rawText: rawText.trim(),
      source,
      photos,
      transcribedText: reviewReady ? transcribedText.trim() : undefined,
    })

    setRawText('')
    setSource('typed')
    setPhotos([])
    setTranscribedText('')
    setReviewReady(false)
    setReviewError(null)
    setReviewMeta(null)
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    setDragActive(false)
    const nextPhotos = Array.from(event.dataTransfer.files ?? []).filter((file) => file.type.startsWith('image/'))
    if (!nextPhotos.length) return
    appendPhotos(nextPhotos)
    setSource('photo')
  }

  async function handleReviewTranscription() {
    if (!photos.length) return

    try {
      setReviewBusy(true)
      setReviewError(null)
      const result = await transcribePhotos(photos)
      setTranscribedText(result.transcript)
      setReviewMeta({ imageCount: result.imageCount, failedCount: result.failedCount })
      setReviewReady(result.anySucceeded)

      if (!result.anySucceeded) {
        setReviewError('The app could not read those images well enough yet. Try adding a bit of typed context, or use clearer JPG/PNG photos.')
      }
    } catch (error) {
      setReviewError(error instanceof Error ? error.message : 'Could not transcribe the photos.')
      setReviewReady(false)
    } finally {
      setReviewBusy(false)
    }
  }

  return (
    <form className="panel composer" onSubmit={handleSubmit}>
      <div className="section-header">
        <div>
          <p className="eyebrow">Capture</p>
          <h2>New entry</h2>
        </div>
        <div className="composer-actions">
          <label className={`source-chip ${source === 'typed' ? 'active' : ''}`}>
            <input
              checked={source === 'typed'}
              name="source"
              onChange={() => setSource('typed')}
              type="radio"
            />
            Type
          </label>
          <label className={`source-chip ${source === 'paste' ? 'active' : ''}`}>
            <input
              checked={source === 'paste'}
              name="source"
              onChange={() => setSource('paste')}
              type="radio"
            />
            Paste
          </label>
          <label className={`source-chip ${source === 'photo' ? 'active' : ''}`}>
            <input
              checked={source === 'photo'}
              name="source"
              onChange={() => setSource('photo')}
              type="radio"
            />
            Photo
          </label>
        </div>
      </div>

      <textarea
        className="entry-textarea"
        onChange={(event) => setRawText(event.target.value)}
        placeholder="What happened? What are you rationalizing? What keeps repeating?"
        rows={10}
        value={rawText}
      />

      <div className="composer-footer">
        <div
          className={`photo-upload ${photos.length ? 'has-photos' : ''} ${dragActive ? 'drag-active' : ''}`}
          onDragEnter={(event) => {
            event.preventDefault()
            setDragActive(true)
          }}
          onDragLeave={(event) => {
            event.preventDefault()
            if (event.currentTarget === event.target) {
              setDragActive(false)
            }
          }}
          onDragOver={(event) => {
            event.preventDefault()
            setDragActive(true)
          }}
          onDrop={handleDrop}
        >
          <div className="photo-upload-header">
            <div>
              <p className="subtle-label">Journal pages</p>
              <h3>{photos.length ? `${photos.length} photo${photos.length > 1 ? 's' : ''} attached` : 'Add journal photos'}</h3>
              <p className="hint upload-sequence-hint">
                Upload in reading order. The app transcribes in the order shown below.
              </p>
              <p className="hint upload-drop-hint">
                Drag images here or use the picker. HEIC, JPG, and PNG are supported.
              </p>
            </div>
            <button
              className="ghost-button"
              onClick={() => fileInputRef.current?.click()}
              type="button"
            >
              <ImagePlus size={16} />
              {photos.length ? 'Add more' : 'Choose files'}
            </button>
          </div>
          <input
            accept="image/*"
            hidden
            multiple
            onChange={(event) => {
              const nextPhotos = Array.from(event.target.files ?? [])
              appendPhotos(nextPhotos)
              if (nextPhotos.length) {
                setSource('photo')
              }
              if (fileInputRef.current) {
                fileInputRef.current.value = ''
              }
            }}
            ref={fileInputRef}
            type="file"
          />
          <div className="capture-steps">
            <span className={`capture-step ${photos.length ? 'done' : ''}`}>1. Add pages</span>
            <span className={`capture-step ${reviewReady ? 'done' : photos.length ? 'active' : ''}`}>2. Transcribe images</span>
            <span className={`capture-step ${reviewReady ? 'active' : ''}`}>3. Submit entry</span>
          </div>
          {photos.length ? (
            <div className="photo-page-list">
              {photos.map((photo, index) => (
                <div className="photo-page-card" key={`${photo.name}-${photo.lastModified}`}>
                  <div className="photo-page-meta">
                    <span className="photo-page-number">Page {index + 1}</span>
                    <strong>{photo.name}</strong>
                  </div>
                  <div className="photo-page-actions">
                    <button className="ghost-button compact-icon" disabled={index === 0} onClick={() => movePhoto(index, -1)} type="button">
                      <ChevronLeft size={16} />
                    </button>
                    <button className="ghost-button compact-icon" disabled={index === photos.length - 1} onClick={() => movePhoto(index, 1)} type="button">
                      <ChevronRight size={16} />
                    </button>
                    <button className="ghost-button compact-icon danger-button" onClick={() => removePhoto(photo)} type="button">
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : null}

          {photos.length ? (
            <div className="photo-review-actions">
              <button className="ghost-button" disabled={reviewBusy} onClick={() => void handleReviewTranscription()} type="button">
                {reviewBusy ? <LoaderCircle className="spin" size={16} /> : <FileText size={16} />}
                {reviewBusy ? 'Reading photos...' : reviewReady ? 'Re-transcribe images' : 'Transcribe images'}
              </button>
              {reviewMeta ? (
                <span className="hint">
                  {reviewMeta.failedCount
                    ? `${reviewMeta.imageCount - reviewMeta.failedCount}/${reviewMeta.imageCount} images read`
                    : `Read ${reviewMeta.imageCount}/${reviewMeta.imageCount} images`}
                </span>
              ) : (
                <span className="hint">Click transcribe images before submitting.</span>
              )}
            </div>
          ) : null}

          {reviewError ? <p className="review-error">{reviewError}</p> : null}

          {reviewReady ? (
            <div className="transcription-review">
              <div className="transcription-review-header">
                <p className="subtle-label">Transcription review</p>
                <span className="hint">Edit here, then submit</span>
              </div>
              <textarea
                className="entry-textarea transcription-textarea"
                onChange={(event) => setTranscribedText(event.target.value)}
                rows={12}
                value={transcribedText}
              />
            </div>
          ) : null}
        </div>

        <button
          className="primary-button"
          disabled={busy || (!rawText.trim() && photos.length === 0) || (photos.length > 0 && !reviewReady)}
          type="submit"
        >
          {busy ? <LoaderCircle className="spin" size={16} /> : <Sparkles size={16} />}
          {busy ? 'Thinking...' : photos.length ? 'Submit reviewed entry' : 'Submit entry'}
        </button>
      </div>
    </form>
  )
}
