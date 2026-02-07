// ── State ───────────────────────────────────────────────────────────────────
let galleryLookup = {};
let galleryList = [];
let currentGallery = null;
let currentPhotos = [];
let currentPhotoIndex = 0;
let masonryInstance = null;

// ── Observer Management ────────────────────────────────────────────────────
let _lazyObserver = null;
let _scrollObserver = null;
let _mutationObserver = null;
let _lightboxClosing = false;

// ── Utilities ──────────────────────────────────────────────────────────────
const _escapeMap = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
function escapeHTML(str) {
    return String(str).replace(/[&<>"']/g, ch => _escapeMap[ch]);
}

function safeCSSId(name) {
    return name.replace(/[^a-zA-Z0-9_-]/g, '_');
}

function debounce(func, wait) {
    let timeout;
    return function (...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func(...args), wait);
    };
}

const _isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

function isSlowConnection() {
    const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (!conn) return false;
    return ['slow-2g', '2g'].includes(conn.effectiveType) || !!conn.saveData;
}

function getObserverSettings() {
    const slow = isSlowConnection();
    return {
        rootMargin: slow ? '400px' : (_isMobile ? '600px' : '800px'),
        threshold: 0.01
    };
}

// ── Gallery Loading ────────────────────────────────────────────────────────
async function fetchWithRetry(url, retries = 3, delay = 500) {
    for (let i = 0; i < retries; i++) {
        try {
            const response = await fetch(url);
            if (response.ok) return response;
            console.warn(`Fetch ${url} returned ${response.status} (attempt ${i + 1}/${retries})`);
        } catch (err) {
            console.warn(`Fetch ${url} failed (attempt ${i + 1}/${retries}):`, err.message);
        }
        if (i < retries - 1) await new Promise(r => setTimeout(r, delay * Math.pow(2, i)));
    }
    throw new Error(`Failed to fetch ${url} after ${retries} attempts`);
}

async function loadGalleries() {
    try {
        const response = await fetchWithRetry('galleries.json');

        const data = await response.json();
        galleryList = data.galleries || [];

        galleryLookup = {};
        galleryList.forEach(g => {
            if (g?.name) {
                galleryLookup[g.name] = g;
                const safeId = safeCSSId(g.name);
                if (!galleryLookup[safeId]) galleryLookup[safeId] = g;
            }
        });

        const albumsGrid = document.getElementById('albumsGrid');
        const coverSizes = '(min-width: 1200px) 33vw, (min-width: 768px) 45vw, 90vw';
        const eagerCount = 6;

        albumsGrid.innerHTML = galleryList.map((gallery, i) => {
            const eager = i < eagerCount;
            const safeId = safeCSSId(gallery.name);
            const safeTitle = escapeHTML(gallery.title);
            const coverSrc = `images/${encodeURIComponent(gallery.name)}/thumbs/${encodeURIComponent(gallery.coverPhoto)}`;

            return `
            <article class="card album-card" data-album="${safeId}" onclick="promptPassword('${safeId}')">
                <div class="card-image">
                    ${!eager ? '<div class="skeleton"></div>' : ''}
                    <img id="cover-${safeId}"
                         ${eager ? `src="${coverSrc}"` : `data-src="${coverSrc}"`}
                         alt="${safeTitle}"
                         class="${eager ? 'eager-cover-img' : 'lazy-cover-img'}"
                         loading="${eager ? 'eager' : 'lazy'}"
                         decoding="async"
                         fetchpriority="${eager ? 'high' : 'auto'}"
                         sizes="${coverSizes}"
                         style="opacity: ${eager ? '1' : '0'};">
                </div>
                <div class="card-content">
                    <h3>${safeTitle}</h3>
                    <button class="btn btn-outline" onclick="promptPassword('${safeId}'); event.stopPropagation();">
                        View <i class="fas fa-arrow-right"></i>
                    </button>
                </div>
            </article>`;
        }).join('');

        initializeLazyLoading();
    } catch (error) {
        console.error('Error loading galleries:', error);
        alert('Failed to load galleries. Please try again.');
    }
}

// ── Lazy Loading ───────────────────────────────────────────────────────────
function initializeLazyLoading() {
    if (!('IntersectionObserver' in window)) {
        document.querySelectorAll('.lazy-cover-img, .lazy-img').forEach(img => {
            if (img.dataset.src) {
                img.src = img.dataset.src;
                if (img.dataset.srcset) img.srcset = img.dataset.srcset;
                img.style.opacity = '1';
                img.classList.add('loaded');
            }
        });
        return;
    }

    if (!_lazyObserver) {
        const settings = getObserverSettings();
        _lazyObserver = new IntersectionObserver((entries, observer) => {
            entries.forEach(entry => {
                if (!entry.isIntersecting) return;
                const img = entry.target;
                if (!img.dataset.src) return;
                observer.unobserve(img);
                loadImageWithRetry(img, img.dataset.src, img.dataset.srcset);
            });
        }, settings);
    }

    document.querySelectorAll('.lazy-cover-img:not(.loaded), .lazy-img:not(.loaded)').forEach(img => {
        if (img.dataset.src && !img.dataset.observed) {
            img.dataset.observed = '1';
            _lazyObserver.observe(img);
        }
    });
}

function loadImageWithRetry(img, src, srcset, retries = 0) {
    const tempImg = new Image();

    tempImg.onerror = () => {
        if (++retries < 3) {
            setTimeout(() => loadImageWithRetry(img, src, srcset, retries), Math.min(1000 * 2 ** retries, 5000));
        } else {
            if (img.previousElementSibling?.classList.contains('skeleton')) img.previousElementSibling.remove();
            img.alt = 'Failed to load image';
            img.style.opacity = '0.5';
        }
    };

    tempImg.onload = () => {
        img.src = src;
        if (srcset) img.srcset = srcset;
        img.style.opacity = '1';
        if (img.previousElementSibling?.classList.contains('skeleton')) img.previousElementSibling.remove();
        img.classList.add('loaded');

        const photoItem = img.closest('.photo-item');
        if (photoItem) photoItem.classList.add('image-loaded');
        if (masonryInstance && img.closest('.photo-grid')) debouncedMasonryLayout();
    };

    tempImg.src = src;
}

// ── Masonry ────────────────────────────────────────────────────────────────
function initializeMasonry(gridElement) {
    if (masonryInstance) {
        masonryInstance.destroy();
        masonryInstance = null;
    }

    if (typeof Masonry === 'undefined') {
        setTimeout(() => initializeMasonry(gridElement), 100);
        return;
    }

    masonryInstance = new Masonry(gridElement, {
        itemSelector: '.photo-item',
        columnWidth: '.photo-grid-sizer',
        gutter: '.photo-grid-gutter-sizer',
        percentPosition: true,
        transitionDuration: '0.3s',
        initLayout: false
    });

    if (typeof imagesLoaded !== 'undefined') {
        imagesLoaded(gridElement, () => masonryInstance?.layout());
    } else {
        masonryInstance.layout();
    }

    return masonryInstance;
}

const debouncedMasonryLayout = debounce(() => {
    if (!masonryInstance) return;
    if (typeof imagesLoaded !== 'undefined') {
        imagesLoaded(masonryInstance.element, () => {
            masonryInstance?.reloadItems();
            masonryInstance?.layout();
        });
    } else {
        masonryInstance.reloadItems();
        masonryInstance.layout();
    }
}, 200);

// ── Password Modal ─────────────────────────────────────────────────────────
function promptPassword(album) {
    currentGallery = album;
    const modal = document.getElementById('passwordModal');
    modal.style.display = 'flex';
    const input = document.getElementById('passwordInput');
    input.value = '';
    input.focus();
    document.getElementById('passwordError').textContent = '';
}

function closePasswordModal() {
    document.getElementById('passwordModal').style.display = 'none';
}

function checkPassword() {
    const input = document.getElementById('passwordInput');
    const password = input.value;
    const galleryPass = galleryLookup[currentGallery]?.password || '';

    if (!galleryPass || galleryPass === password) {
        loadGallery(currentGallery);
        closePasswordModal();
        return;
    }

    document.getElementById('passwordError').textContent = 'Incorrect password. Please try again.';
    input.classList.add('error');
    setTimeout(() => input.classList.remove('error'), 2000);
}

// ── Loading Overlay ────────────────────────────────────────────────────────
function showLoading(message = 'Loading gallery...') {
    document.getElementById('loadingOverlay')?.remove();

    const overlay = document.createElement('div');
    overlay.id = 'loadingOverlay';
    overlay.className = 'loading-overlay';
    overlay.innerHTML = `
        <div class="loading-overlay-content">
            <div class="loading-spinner"></div>
            <p class="loading-text">${escapeHTML(message)}</p>
        </div>
    `;
    document.body.appendChild(overlay);
    void overlay.offsetWidth;
    overlay.classList.add('visible');
}

function hideLoading() {
    const overlay = document.getElementById('loadingOverlay');
    if (!overlay || overlay.classList.contains('hiding')) return;
    overlay.classList.remove('visible');
    overlay.classList.add('hiding');
    setTimeout(() => overlay.remove(), 300);
}

// ── Gallery View ───────────────────────────────────────────────────────────
async function loadGallery(album) {
    showLoading('Loading gallery...');
    try {
        const gallery = galleryLookup[album];
        if (!gallery) throw new Error('Gallery not found');

        let photos = gallery.photos || [];
        if (!photos.length) {
            try {
                const res = await fetch(`images/${encodeURIComponent(gallery.name)}/manifest.json`);
                if (res.ok) photos = await res.json();
            } catch (err) {
                console.warn('Manifest load failed:', err);
            }
        }

        const downloadLink = gallery.downloadLink || '#';
        currentPhotos = photos.map(p => `images/${encodeURIComponent(gallery.name)}/${encodeURIComponent(p)}`);

        const threshold = _isMobile ? 30 : 50;
        if (photos.length > threshold) {
            loadGalleryVirtual(album, photos, downloadLink);
        } else {
            loadGalleryStandard(album, photos, downloadLink);
        }

        requestAnimationFrame(() => setTimeout(hideLoading, 200));
    } catch (error) {
        hideLoading();
        console.error('Error loading gallery:', error);
        alert('Failed to load gallery. Please try again.');
    }
}

function loadGalleryStandard(album, photos, downloadLink) {
    const gallery = galleryLookup[album];
    const title = escapeHTML(gallery?.title || album);
    const safeId = safeCSSId(album);
    const encodedAlbum = encodeURIComponent(gallery?.name || album);
    const photoSizes = '(min-width: 1200px) 22vw, (min-width: 900px) 28vw, (min-width: 600px) 42vw, 90vw';

    document.getElementById('galleryContainer').innerHTML = `
        <section class="gallery">
            <header class="gallery-header">
                <button class="btn back-btn" onclick="exitGallery()">
                    <i class="fas fa-arrow-left"></i> Back
                </button>
                <h2>${title}</h2>
                <a class="btn btn-primary btn-download" href="${escapeHTML(downloadLink)}" target="_blank" rel="noopener">
                    <i class="fas fa-download"></i> Download All
                </a>
            </header>
            <div class="photo-grid" id="photoGrid">
                <div class="photo-grid-sizer"></div>
                <div class="photo-grid-gutter-sizer"></div>
                ${photos.map((photo, i) => `
                    <div class="photo-item" id="photoItem-${i}" onclick="openLightbox(${i})">
                        <div class="skeleton"></div>
                        <img data-src="images/${encodedAlbum}/thumbs/${encodeURIComponent(photo)}" alt="${escapeHTML(photo)}" class="lazy-img" loading="lazy" decoding="async" sizes="${photoSizes}" style="opacity: 0;">
                    </div>
                `).join('')}
            </div>
            <div class="progress-bar" id="progress-${safeId}"><div class="progress"></div></div>
        </section>
    `;

    document.querySelector('.portfolio-section').style.display = 'none';
    document.querySelector('.gallery').scrollIntoView({ behavior: 'smooth' });
    document.removeEventListener('keydown', handleKeyboardNav);
    document.addEventListener('keydown', handleKeyboardNav);

    initializeMasonry(document.getElementById('photoGrid'));
    initializeLazyLoading();
}

function loadGalleryVirtual(album, photos, downloadLink) {
    const gallery = galleryLookup[album];
    const title = escapeHTML(gallery?.title || album);
    const safeId = safeCSSId(album);
    const encodedAlbum = encodeURIComponent(gallery?.name || album);
    const slow = isSlowConnection();
    const BATCH = (_isMobile || slow) ? 10 : 20;
    const photoSizes = '(min-width: 1200px) 22vw, (min-width: 900px) 28vw, (min-width: 600px) 42vw, 90vw';
    let rendered = 0;
    let masonryReady = false;

    document.getElementById('galleryContainer').innerHTML = `
        <section class="gallery">
            <header class="gallery-header">
                <button class="btn back-btn" onclick="exitGallery()">
                    <i class="fas fa-arrow-left"></i> Back
                </button>
                <h2>${title}</h2>
                <a class="btn btn-primary btn-download" href="${escapeHTML(downloadLink)}" target="_blank" rel="noopener">
                    <i class="fas fa-download"></i> Download All
                </a>
            </header>
            <div class="photo-grid" id="photoGrid">
                <div class="photo-grid-sizer"></div>
                <div class="photo-grid-gutter-sizer"></div>
            </div>
            <div class="progress-bar" id="progress-${safeId}"><div class="progress"></div></div>
        </section>
    `;

    document.querySelector('.portfolio-section').style.display = 'none';
    document.querySelector('.gallery').scrollIntoView({ behavior: 'smooth' });
    document.removeEventListener('keydown', handleKeyboardNav);
    document.addEventListener('keydown', handleKeyboardNav);

    const photoGrid = document.getElementById('photoGrid');

    function renderBatch() {
        const fragment = document.createDocumentFragment();
        const end = Math.min(rendered + BATCH, photos.length);

        for (let i = rendered; i < end; i++) {
            const div = document.createElement('div');
            div.className = 'photo-item';
            div.id = `photoItem-${i}`;
            div.onclick = () => openLightbox(i);
            div.innerHTML = `
                <div class="skeleton"></div>
                <img data-src="images/${encodedAlbum}/thumbs/${encodeURIComponent(photos[i])}" alt="${escapeHTML(photos[i])}" class="lazy-img" loading="lazy" decoding="async" sizes="${photoSizes}" style="opacity: 0;">
            `;
            fragment.appendChild(div);
        }

        photoGrid.appendChild(fragment);
        rendered = end;

        if (!masonryReady && rendered > 0) {
            initializeMasonry(photoGrid);
            masonryReady = true;
        } else if (masonryReady) {
            debouncedMasonryLayout();
        }

        initializeLazyLoading();

        const progressBar = document.getElementById(`progress-${safeId}`)?.querySelector('.progress');
        if (progressBar) progressBar.style.width = `${(rendered / photos.length) * 100}%`;
    }

    renderBatch();
    cleanupScrollObservers();

    _scrollObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting && rendered < photos.length) renderBatch();
        });
    }, { rootMargin: '200px' });

    function observeLast() {
        const items = photoGrid.querySelectorAll('.photo-item');
        const last = items[items.length - 1];
        if (last && rendered < photos.length) _scrollObserver.observe(last);
    }

    setTimeout(observeLast, 100);

    _mutationObserver = new MutationObserver(() => {
        _scrollObserver.disconnect();
        observeLast();
    });
    _mutationObserver.observe(photoGrid, { childList: true });
}

function cleanupScrollObservers() {
    _scrollObserver?.disconnect();
    _scrollObserver = null;
    _mutationObserver?.disconnect();
    _mutationObserver = null;
}

// ── Exit Gallery ───────────────────────────────────────────────────────────
function exitGallery() {
    cleanupScrollObservers();

    if (masonryInstance) {
        masonryInstance.destroy();
        masonryInstance = null;
    }

    if (_lazyObserver) {
        document.querySelectorAll('.photo-grid .lazy-img').forEach(img => _lazyObserver.unobserve(img));
    }

    document.getElementById('galleryContainer').innerHTML = '';
    document.removeEventListener('keydown', handleKeyboardNav);
    currentPhotos = [];
    currentPhotoIndex = 0;

    const portfolio = document.querySelector('.portfolio-section');
    if (portfolio) {
        portfolio.style.display = '';
        portfolio.scrollIntoView({ behavior: 'smooth' });
    }
}

// ── Lightbox ───────────────────────────────────────────────────────────────
function openLightbox(index) {
    if (_lightboxClosing) return;
    currentPhotoIndex = index;
    const lightbox = document.getElementById('lightbox');
    lightbox.classList.remove('closing');
    lightbox.style.display = 'block';
    void lightbox.offsetWidth;
    updateLightboxCounter();
    preloadLightboxImage(index);
    document.body.style.overflow = 'hidden';
}

function preloadLightboxImage(index) {
    const lightboxImg = document.getElementById('lightboxImage');
    lightboxImg.classList.remove('loaded');

    const temp = new Image();
    temp.onload = () => {
        lightboxImg.src = currentPhotos[index];
        requestAnimationFrame(() => lightboxImg.classList.add('loaded'));
    };
    temp.onerror = () => {
        lightboxImg.src = currentPhotos[index];
        lightboxImg.classList.add('loaded');
    };
    temp.src = currentPhotos[index];

    // Preload adjacent images
    if (currentPhotos.length > 1) {
        const next = (index + 1) % currentPhotos.length;
        const prev = (index - 1 + currentPhotos.length) % currentPhotos.length;
        new Image().src = currentPhotos[next];
        if (next !== prev) new Image().src = currentPhotos[prev];
    }
}

function updateLightboxCounter() {
    const counter = document.getElementById('lightboxCounter');
    if (counter) counter.textContent = `${currentPhotoIndex + 1} / ${currentPhotos.length}`;
}

function closeLightbox() {
    if (_lightboxClosing) return;
    _lightboxClosing = true;

    const lightbox = document.getElementById('lightbox');
    lightbox.classList.add('closing');
    document.body.style.overflow = '';

    setTimeout(() => {
        lightbox.style.display = 'none';
        lightbox.classList.remove('closing');
        _lightboxClosing = false;
    }, 300);
}

const debouncedNavigate = debounce((dir) => {
    if (!currentPhotos.length) return;
    currentPhotoIndex = (currentPhotoIndex + dir + currentPhotos.length) % currentPhotos.length;
    updateLightboxCounter();
    preloadLightboxImage(currentPhotoIndex);
}, 150);

function navigatePhoto(dir) {
    debouncedNavigate(dir);
}

function handleKeyboardNav(e) {
    const lightbox = document.getElementById('lightbox');
    if (lightbox.style.display !== 'block' || _lightboxClosing) return;

    switch (e.key) {
        case 'ArrowLeft':  e.preventDefault(); navigatePhoto(-1); break;
        case 'ArrowRight': e.preventDefault(); navigatePhoto(1);  break;
        case 'Escape':     e.preventDefault(); closeLightbox();   break;
    }
}

// ── Init ───────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
    if ('ontouchstart' in window) document.body.classList.add('touch-device');

    // Prevent double-tap zoom on interactive elements
    document.addEventListener('touchend', (e) => {
        if (e.target.closest?.('button, .btn, .album-card')) {
            const now = Date.now();
            if (now - (e.target._lastTouchEnd || 0) <= 300) e.preventDefault();
            e.target._lastTouchEnd = now;
        }
    }, { passive: false });

    document.getElementById('passwordInput')?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); checkPassword(); }
    });

    await loadGalleries();
});
