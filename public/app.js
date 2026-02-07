// ── State ───────────────────────────────────────────────────────────────────
let galleryLookup = {};
let galleryList = [];
let currentGallery = null;
let currentPhotos = [];
let currentPhotoIndex = 0;
let masonryInstance = null;

// ── Observer Management (single instances, properly cleaned up) ─────────────
let _lazyObserver = null;
let _scrollObserver = null;
let _mutationObserver = null;
let _lightboxClosing = false;

// ── Utility: sanitize a string for safe insertion into HTML ─────────────────
const _escapeMap = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
function escapeHTML(str) {
    return String(str).replace(/[&<>"']/g, ch => _escapeMap[ch]);
}

// ── Utility: create a safe CSS-friendly ID from a gallery name ──────────────
function safeCSSId(name) {
    return name.replace(/[^a-zA-Z0-9_-]/g, '_');
}

// ── Debounce utility ────────────────────────────────────────────────────────
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func(...args), wait);
    };
}

// ── Connection / device detection (cached) ──────────────────────────────────
const _isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

function isSlowConnection() {
    const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (!connection) return false;
    if (['slow-2g', '2g'].includes(connection.effectiveType)) return true;
    return !!connection.saveData;
}

function getOptimalObserverSettings() {
    const slow = isSlowConnection();
    return {
        rootMargin: slow ? '200px' : (_isMobile ? '150px' : '50px'),
        threshold: slow ? 0.1 : 0.01
    };
}

async function loadGalleries() {
    try {
        const [response, secretsResponse] = await Promise.all([
            fetch('images/galleries.json'),
            fetch('secrets.json').catch(() => null)
        ]);
        if (!response.ok) throw new Error('Failed to load galleries');

        const data = await response.json();
        galleryList = data.galleries || [];

        try {
            if (secretsResponse && secretsResponse.ok) {
                const secrets = await secretsResponse.json();
                galleryList = galleryList.map(g => ({
                    ...g,
                    password: g.password || secrets[g.name]?.password || '',
                    downloadLink: g.downloadLink || secrets[g.name]?.downloadLink || ''
                }));
            }
        } catch (err) {
            console.warn('Secrets not loaded (fallback):', err);
        }

        galleryLookup = {};
        galleryList.forEach(g => {
            if (g && g.name) {
                galleryLookup[g.name] = g;
                const safeId = safeCSSId(g.name);
                // Only index by safeCSSId if it doesn't collide with another gallery name
                if (!galleryLookup[safeId]) {
                    galleryLookup[safeId] = g;
                }
            }
        });

        const albumsGrid = document.getElementById('albumsGrid');
        const coverSizes = '(min-width: 1200px) 33vw, (min-width: 768px) 45vw, 90vw';
        const eagerLoadCount = 3;

        albumsGrid.innerHTML = galleryList.map((gallery, index) => {
            const isEager = index < eagerLoadCount;
            const safeId = safeCSSId(gallery.name);
            const safeTitle = escapeHTML(gallery.title);
            const coverSrc = `images/${encodeURIComponent(gallery.name)}/${encodeURIComponent(gallery.coverPhoto)}`;

            return `
            <article class="card album-card" data-album="${safeId}" onclick="promptPassword('${safeId}')">
                <div class="card-image">
                    ${!isEager ? '<div class="skeleton"></div>' : ''}
                    <img id="cover-${safeId}"
                         ${isEager ? `src="${coverSrc}"` : `data-src="${coverSrc}"`}
                         alt="${safeTitle}"
                         class="${isEager ? 'eager-cover-img' : 'lazy-cover-img'}"
                         loading="${isEager ? 'eager' : 'lazy'}"
                         decoding="async"
                         fetchpriority="${isEager ? 'high' : 'auto'}"
                         sizes="${coverSizes}"
                         style="opacity: ${isEager ? '1' : '0'};">
                </div>
                <div class="card-content">
                    <h3>${safeTitle}</h3>
                    <button class="btn btn-outline" onclick="promptPassword('${safeId}'); event.stopPropagation();">
                        Enter <i class="fas fa-arrow-right"></i>
                    </button>
                </div>
            </article>
        `;
        }).join('');

        initializeLazyLoading();
    } catch (error) {
        console.error('Error loading galleries:', error);
        alert('Failed to load galleries. Please try again.');
    }
}

// ── Lazy Loading (single shared IntersectionObserver) ────────────────────────
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

    // Create observer only once, reuse it across calls
    if (!_lazyObserver) {
        const settings = getOptimalObserverSettings();
        _lazyObserver = new IntersectionObserver((entries, observer) => {
            entries.forEach(entry => {
                if (!entry.isIntersecting) return;
                const img = entry.target;
                const src = img.dataset.src;
                if (!src) return;
                observer.unobserve(img);
                loadImageWithRetry(img, src, img.dataset.srcset);
            });
        }, {
            rootMargin: settings.rootMargin,
            threshold: settings.threshold
        });
    }

    // Observe only new unloaded images
    document.querySelectorAll('.lazy-cover-img:not(.loaded), .lazy-img:not(.loaded)').forEach(img => {
        if (img.dataset.src && !img.src) {
            _lazyObserver.observe(img);
        }
    });
}

function loadImageWithRetry(img, src, srcset, retryCount = 0) {
    const maxRetries = 3;
    const tempImg = new Image();

    tempImg.onerror = () => {
        retryCount++;
        if (retryCount < maxRetries) {
            const delay = Math.min(1000 * Math.pow(2, retryCount), 5000);
            setTimeout(() => loadImageWithRetry(img, src, srcset, retryCount), delay);
        } else {
            const skeleton = img.previousElementSibling;
            if (skeleton?.classList.contains('skeleton')) {
                skeleton.remove();
            }
            img.alt = 'Failed to load image';
            img.style.opacity = '0.5';
        }
    };

    tempImg.onload = () => {
        img.src = src;
        if (srcset) img.srcset = srcset;
        img.style.opacity = '1';

        const skeleton = img.previousElementSibling;
        if (skeleton?.classList.contains('skeleton')) {
            skeleton.remove();
        }
        img.classList.add('loaded');

        const photoItem = img.closest('.photo-item');
        if (photoItem) {
            photoItem.classList.add('image-loaded');
        }

        if (masonryInstance && img.closest('.photo-grid')) {
            debouncedMasonryLayout();
        }
    };

    tempImg.src = src;
}

function initializeMasonry(gridElement) {
    if (masonryInstance) {
        masonryInstance.destroy();
        masonryInstance = null;
    }

    if (typeof Masonry === 'undefined') {
        console.warn('Masonry library not loaded yet, retrying...');
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

// Debounced masonry layout update to batch rapid image loads
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

function promptPassword(album) {
    currentGallery = album;
    const modal = document.getElementById('passwordModal');
    modal.style.display = 'flex';
    const input = document.getElementById('albumPasscodeInput');
    input.value = '';
    input.focus();
    document.getElementById('passwordError').textContent = '';
}

function closePasswordPrompt() {
    document.getElementById('passwordModal').style.display = 'none';
}

function checkAlbumPasscode() {
    const passcode = document.getElementById('albumPasscodeInput').value;
    const errorElement = document.getElementById('passwordError');
    const galleryPass = galleryLookup[currentGallery]?.password || '';

    if (!galleryPass || galleryPass === passcode) {
        loadGallery(currentGallery);
        closePasswordPrompt();
        return;
    }

    errorElement.textContent = 'Incorrect passcode. Please try again.';
    const input = document.getElementById('albumPasscodeInput');
    input.classList.add('error');
    setTimeout(() => input.classList.remove('error'), 2000);
}

async function loadGallery(album) {
    try {
        const gallery = galleryLookup[album];
        if (!gallery) throw new Error('Gallery not found');

        let photos = gallery.photos || [];
        if (!photos.length) {
            try {
                const manifestResponse = await fetch(`images/${encodeURIComponent(gallery.name)}/manifest.json`);
                if (manifestResponse.ok) {
                    photos = await manifestResponse.json();
                }
            } catch (err) {
                console.warn('Manifest fallback failed:', err);
            }
        }

        const downloadLink = gallery.downloadLink || '#';
        currentPhotos = photos.map(photo => `images/${encodeURIComponent(gallery.name)}/${encodeURIComponent(photo)}`);

        const threshold = _isMobile ? 30 : 50;
        if (photos.length > threshold) {
            loadGalleryWithVirtualScrolling(album, photos, downloadLink);
        } else {
            loadGalleryNormal(album, photos, downloadLink);
        }
    } catch (error) {
        console.error('Error loading gallery:', error);
        alert('Failed to load gallery. Please try again.');
        closePasswordPrompt();
    }
}

function loadGalleryNormal(album, photos, downloadLink) {
    const gallery = galleryLookup[album];
    const displayTitle = escapeHTML(gallery ? gallery.title : album);
    const safeId = safeCSSId(album);
    const encodedAlbum = encodeURIComponent(gallery ? gallery.name : album);
    const photoSizes = '(min-width: 1200px) 22vw, (min-width: 900px) 28vw, (min-width: 600px) 42vw, 90vw';

    const galleryHTML = `
        <section class="gallery">
            <header class="gallery-header">
                <button class="btn back-btn" onclick="exitGallery()">
                    <i class="fas fa-arrow-left"></i> Back to Collections
                </button>
                <h2>${displayTitle}</h2>
                <a class="btn btn-primary btn-download" href="${escapeHTML(downloadLink)}" target="_blank" rel="noopener">
                    <i class="fas fa-download"></i> Download All
                </a>
            </header>
            <div class="photo-grid" id="photoGrid">
                <div class="photo-grid-sizer"></div>
                <div class="photo-grid-gutter-sizer"></div>
                ${photos.map((photo, index) => `
                    <div class="photo-item" id="photoItem-${index}" onclick="openLightbox(${index})">
                        <div class="skeleton"></div>
                        <img src="" alt="${escapeHTML(photo)}" class="lazy-img" loading="lazy" decoding="async" sizes="${photoSizes}" style="opacity: 0;">
                    </div>
                `).join('')}
            </div>
            <div class="progress-bar" id="progress-${safeId}"><div class="progress"></div></div>
        </section>
    `;

    document.getElementById('galleryContainer').innerHTML = galleryHTML;
    document.querySelector('.portfolio-section').style.display = 'none';
    document.querySelector('.gallery').scrollIntoView({ behavior: 'smooth' });

    document.removeEventListener('keydown', handleKeyboardNavigation);
    document.addEventListener('keydown', handleKeyboardNavigation);

    // Set data-src for lazy loading
    const imgElements = document.querySelectorAll('.photo-item img');
    imgElements.forEach((imgElement, index) => {
        imgElement.dataset.src = `images/${encodedAlbum}/${encodeURIComponent(photos[index])}`;
    });

    const photoGrid = document.getElementById('photoGrid');
    initializeMasonry(photoGrid);
    initializeLazyLoading();
}

function loadGalleryWithVirtualScrolling(album, photos, downloadLink) {
    const gallery = galleryLookup[album];
    const displayTitle = escapeHTML(gallery ? gallery.title : album);
    const safeId = safeCSSId(album);
    const encodedAlbum = encodeURIComponent(gallery ? gallery.name : album);
    const slow = isSlowConnection();
    const BATCH_SIZE = (_isMobile || slow) ? 10 : 20;
    const photoSizes = '(min-width: 1200px) 22vw, (min-width: 900px) 28vw, (min-width: 600px) 42vw, 90vw';
    let renderedCount = 0;
    let masonryInitialized = false;

    const galleryHTML = `
        <section class="gallery">
            <header class="gallery-header">
                <button class="btn back-btn" onclick="exitGallery()">
                    <i class="fas fa-arrow-left"></i> Back to Collections
                </button>
                <h2>${displayTitle}</h2>
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

    document.getElementById('galleryContainer').innerHTML = galleryHTML;
    document.querySelector('.portfolio-section').style.display = 'none';
    document.querySelector('.gallery').scrollIntoView({ behavior: 'smooth' });

    document.removeEventListener('keydown', handleKeyboardNavigation);
    document.addEventListener('keydown', handleKeyboardNavigation);

    const photoGrid = document.getElementById('photoGrid');

    function renderBatch() {
        const fragment = document.createDocumentFragment();
        const end = Math.min(renderedCount + BATCH_SIZE, photos.length);

        for (let i = renderedCount; i < end; i++) {
            const div = document.createElement('div');
            div.className = 'photo-item';
            div.id = `photoItem-${i}`;
            div.onclick = () => openLightbox(i);
            div.innerHTML = `
                <div class="skeleton"></div>
                <img data-src="images/${encodedAlbum}/${encodeURIComponent(photos[i])}" alt="${escapeHTML(photos[i])}" class="lazy-img" loading="lazy" decoding="async" sizes="${photoSizes}" style="opacity: 0;">
            `;
            fragment.appendChild(div);
        }

        photoGrid.appendChild(fragment);
        renderedCount = end;

        if (!masonryInitialized && renderedCount > 0) {
            initializeMasonry(photoGrid);
            masonryInitialized = true;
        } else if (masonryInitialized) {
            debouncedMasonryLayout();
        }

        initializeLazyLoading();

        const progress = (renderedCount / photos.length) * 100;
        const progressEl = document.getElementById(`progress-${safeId}`);
        const progressBar = progressEl?.querySelector('.progress');
        if (progressBar) {
            progressBar.style.width = `${progress}%`;
        }
    }

    renderBatch();

    // Clean up any previous scroll/mutation observers
    cleanupScrollObservers();

    _scrollObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting && renderedCount < photos.length) {
                renderBatch();
            }
        });
    }, { rootMargin: '200px' });

    function observeLastPhotoItem() {
        // Target actual photo items, not sizer/gutter elements
        const items = photoGrid.querySelectorAll('.photo-item');
        const lastItem = items[items.length - 1];
        if (lastItem && renderedCount < photos.length) {
            _scrollObserver.observe(lastItem);
        }
    }

    setTimeout(observeLastPhotoItem, 100);

    _mutationObserver = new MutationObserver(() => {
        _scrollObserver.disconnect();
        observeLastPhotoItem();
    });
    _mutationObserver.observe(photoGrid, { childList: true });
}

function cleanupScrollObservers() {
    if (_scrollObserver) {
        _scrollObserver.disconnect();
        _scrollObserver = null;
    }
    if (_mutationObserver) {
        _mutationObserver.disconnect();
        _mutationObserver = null;
    }
}

function exitGallery() {
    const modalHTML = `
        <div class="exit-modal" id="exitModal">
            <div class="exit-modal-dialog">
                <div class="exit-modal-header">
                    <h3>Exit Gallery</h3>
                    <button class="icon-btn" onclick="closeExitModal()">&times;</button>
                </div>
                <div class="exit-modal-body">
                    <p>Are you sure you want to exit this gallery?</p>
                </div>
                <div class="exit-modal-footer">
                    <button class="btn btn-outline" onclick="closeExitModal()">Cancel</button>
                    <button class="btn btn-primary" onclick="confirmExitGallery()">Exit</button>
                </div>
            </div>
        </div>
    `;
    document.body.insertAdjacentHTML('beforeend', modalHTML);
    document.getElementById('exitModal').style.display = 'flex';
}

function closeExitModal() {
    const modal = document.getElementById('exitModal');
    if (modal) {
        modal.remove();
    }
}

function confirmExitGallery() {
    // Clean up all observers
    cleanupScrollObservers();

    // Destroy masonry instance
    if (masonryInstance) {
        masonryInstance.destroy();
        masonryInstance = null;
    }

    // Unobserve gallery images from lazy observer (keep observer alive for covers)
    if (_lazyObserver) {
        document.querySelectorAll('.photo-grid .lazy-img').forEach(img => {
            _lazyObserver.unobserve(img);
        });
    }

    document.getElementById('galleryContainer').innerHTML = '';
    document.removeEventListener('keydown', handleKeyboardNavigation);

    // Reset photo state
    currentPhotos = [];
    currentPhotoIndex = 0;

    // Show the portfolio section again
    const portfolioSection = document.querySelector('.portfolio-section');
    if (portfolioSection) {
        portfolioSection.style.display = '';
        portfolioSection.scrollIntoView({ behavior: 'smooth' });
    }
    closeExitModal();
}

// ── Lightbox Functions ──────────────────────────────────────────────────────
function openLightbox(index) {
    if (_lightboxClosing) return;
    currentPhotoIndex = index;
    const lightbox = document.getElementById('lightbox');

    lightbox.classList.remove('closing');
    lightbox.style.display = 'block';
    void lightbox.offsetWidth;

    updateLightboxCounter();
    preloadLightboxImages(index);
    document.body.style.overflow = 'hidden';
}

function preloadLightboxImages(index) {
    const lightboxImage = document.getElementById('lightboxImage');
    lightboxImage.classList.remove('loaded');

    const tempImg = new Image();

    tempImg.onload = () => {
        lightboxImage.src = currentPhotos[index];
        requestAnimationFrame(() => lightboxImage.classList.add('loaded'));
    };

    tempImg.onerror = () => {
        console.error('Failed to load image:', currentPhotos[index]);
        lightboxImage.src = currentPhotos[index];
        lightboxImage.classList.add('loaded');
    };

    tempImg.src = currentPhotos[index];

    // Preload adjacent images for smooth navigation
    if (currentPhotos.length > 1) {
        const nextIdx = (index + 1) % currentPhotos.length;
        const prevIdx = (index - 1 + currentPhotos.length) % currentPhotos.length;
        new Image().src = currentPhotos[nextIdx];
        if (nextIdx !== prevIdx) {
            new Image().src = currentPhotos[prevIdx];
        }
    }
}

function updateLightboxCounter() {
    const counter = document.getElementById('lightboxCounter');
    if (counter) {
        counter.textContent = `${currentPhotoIndex + 1} / ${currentPhotos.length}`;
    }
}

function closeModal() {
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

const debouncedNavigatePhoto = debounce((direction) => {
    if (!currentPhotos.length) return;
    currentPhotoIndex = (currentPhotoIndex + direction + currentPhotos.length) % currentPhotos.length;
    updateLightboxCounter();
    preloadLightboxImages(currentPhotoIndex);
}, 150);

function navigatePhoto(direction) {
    debouncedNavigatePhoto(direction);
}

function handleKeyboardNavigation(e) {
    const lightbox = document.getElementById('lightbox');
    const isVisible = lightbox.style.display === 'block' && !_lightboxClosing;
    if (!isVisible) return;

    switch (e.key) {
        case 'ArrowLeft':
            e.preventDefault();
            navigatePhoto(-1);
            break;
        case 'ArrowRight':
            e.preventDefault();
            navigatePhoto(1);
            break;
        case 'Escape':
            e.preventDefault();
            closeModal();
            break;
    }
}

// ── Performance Logging (deferred) ──────────────────────────────────────────
function logPerformanceInfo() {
    const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    console.log('Device Info:', {
        isMobile: _isMobile,
        connection: connection ? {
            effectiveType: connection.effectiveType,
            downlink: connection.downlink,
            rtt: connection.rtt,
            saveData: connection.saveData
        } : 'Not available',
        viewport: `${window.innerWidth}x${window.innerHeight}`,
        supportsIntersectionObserver: 'IntersectionObserver' in window
    });
}

// ── Initialization ──────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
    const deferLog = window.requestIdleCallback || ((cb) => setTimeout(cb, 150));
    deferLog(logPerformanceInfo);

    if ('ontouchstart' in window) {
        document.body.classList.add('touch-device');
    }

    // Prevent double-tap zoom on interactive elements
    document.addEventListener('touchend', function (event) {
        if (event.target.closest?.('button, .btn, .album-card')) {
            const now = Date.now();
            if (now - (event.target._lastTouchEnd || 0) <= 300) {
                event.preventDefault();
            }
            event.target._lastTouchEnd = now;
        }
    }, { passive: false });

    // Set up Enter key handler for password input (inside DOMContentLoaded to ensure element exists)
    const passcodeInput = document.getElementById('albumPasscodeInput');
    if (passcodeInput) {
        passcodeInput.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                checkAlbumPasscode();
            }
        });
    }

    await loadGalleries();
});