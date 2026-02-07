let galleryLookup = {};
let galleryList = [];
let currentGallery = null;
let currentPhotos = [];
let currentPhotoIndex = 0;
let currentZip = null;
let masonryInstance = null;

// Utility: sanitize a string for safe insertion into HTML
const _escapeMap = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
function escapeHTML(str) {
    return String(str).replace(/[&<>"']/g, ch => _escapeMap[ch]);
}

// Utility: create a safe CSS-friendly ID from a gallery name
function safeCSSId(name) {
    return name.replace(/[^a-zA-Z0-9_-]/g, '_');
}

async function loadGalleries() {
    try {
        // Fetch galleries and secrets in parallel
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
                // Also index by safe CSS ID for promptPassword lookups
                galleryLookup[safeCSSId(g.name)] = g;
            }
        });
        const albumsGrid = document.getElementById('albumsGrid');

        // Responsive hints for covers to avoid over-downloading on small screens
        const coverSizes = '(min-width: 1200px) 33vw, (min-width: 768px) 45vw, 90vw';
        
        // First 3 galleries should load eagerly
        const eagerLoadCount = 3;
        
        albumsGrid.innerHTML = galleryList.map((gallery, index) => {
            const isEager = index < eagerLoadCount;
            const safeId = safeCSSId(gallery.name);
            const safeTitle = escapeHTML(gallery.title);
            const coverSrc = `images/${encodeURIComponent(gallery.name)}/${encodeURIComponent(gallery.coverPhoto)}`;
            
            return `
            <article class="card album-card" data-album="${safeId}" onclick="promptPassword('${safeId}')">
                <div class="card-image">
                    <div class="image-overlay"></div>
                    ${!isEager ? '<div class="skeleton"></div>' : ''}
                    <img id="cover-${safeId}" 
                         ${isEager ? `src="${coverSrc}"` : `data-src="${coverSrc}"`}
                         alt="${safeTitle}" 
                         class="${isEager ? 'eager-cover-img' : 'lazy-cover-img'}"
                         loading="${isEager ? 'eager' : 'lazy'}"
                         decoding="async"
                         fetchpriority="${isEager ? 'high' : 'auto'}"
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
        
        // Initialize lazy loading for cover images (only for lazy-loaded ones)
        initializeLazyLoading();
    } catch (error) {
        console.error('Error loading galleries:', error);
        alert('Failed to load galleries. Please try again.');
    }
}

// Improved Intersection Observer for lazy loading with mobile optimizations
function initializeLazyLoading() {
    // Check if IntersectionObserver is supported
    if (!('IntersectionObserver' in window)) {
        // Fallback: load all images immediately for older browsers
        document.querySelectorAll('.lazy-cover-img, .lazy-img').forEach(img => {
            const src = img.dataset.src;
            const srcset = img.dataset.srcset;
            if (src) {
                img.src = src;
                if (srcset) img.srcset = srcset;
                img.style.opacity = '1';
                img.classList.add('loaded');
            }
        });
        return;
    }

    // More aggressive loading for mobile devices
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    const settings = getOptimalObserverSettings();
    const rootMargin = isMobile ? settings.rootMargin : '50px';
    
    const imageObserver = new IntersectionObserver((entries, observer) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const img = entry.target;
                const src = img.dataset.src;
                const srcset = img.dataset.srcset;
                
                if (src) {
                    let retryCount = 0;
                    const maxRetries = 3;
                    
                    // Function to load image with retry logic
                    const loadImage = () => {
                        const tempImg = new Image();
                        
                        // Add error handling for failed loads
                        tempImg.onerror = () => {
                            console.error(`Failed to load image (attempt ${retryCount + 1}): ${src}`);
                            retryCount++;
                            
                            // Retry with exponential backoff
                            if (retryCount < maxRetries) {
                                const delay = Math.min(1000 * Math.pow(2, retryCount), 5000);
                                setTimeout(loadImage, delay);
                            } else {
                                // Show error state after max retries
                                const skeleton = img.previousElementSibling;
                                if (skeleton && skeleton.classList.contains('skeleton')) {
                                    skeleton.style.display = 'none';
                                }
                                img.alt = 'Failed to load image';
                                img.style.opacity = '0.5';
                            }
                        };
                        
                        tempImg.onload = () => {
                            img.src = src;
                            if (srcset) img.srcset = srcset;
                            img.style.opacity = '1';
                            img.style.transition = 'opacity 0.3s ease-in';
                            // Remove skeleton loader
                            const skeleton = img.previousElementSibling;
                            if (skeleton && skeleton.classList.contains('skeleton')) {
                                skeleton.style.display = 'none';
                                skeleton.remove(); // Completely remove skeleton from DOM
                            }
                            img.classList.add('loaded');
                            
                            // Add loaded class to parent photo-item
                            const photoItem = img.closest('.photo-item');
                            if (photoItem) {
                                photoItem.classList.add('image-loaded');
                            }
                            
                            // Update masonry layout when image loads
                            if (masonryInstance && img.closest('.photo-grid')) {
                                updateMasonryLayout();
                            }
                        };
                        
                        tempImg.src = src;
                    };
                    
                    loadImage();
                    observer.unobserve(img);
                }
            }
        });
    }, {
        rootMargin: rootMargin,
        threshold: settings.threshold
    });

    // Observe all lazy images
    document.querySelectorAll('.lazy-cover-img, .lazy-img').forEach(img => {
        imageObserver.observe(img);
    });
}

// Initialize Masonry layout for gallery
function initializeMasonry(gridElement) {
    // Destroy existing instance if any
    if (masonryInstance) {
        masonryInstance.destroy();
        masonryInstance = null;
    }
    
    // Wait for Masonry library to be available
    if (typeof Masonry === 'undefined') {
        console.warn('Masonry library not loaded yet, retrying...');
        setTimeout(() => initializeMasonry(gridElement), 100);
        return;
    }
    
    // Initialize masonry
    masonryInstance = new Masonry(gridElement, {
        itemSelector: '.photo-item',
        columnWidth: '.photo-grid-sizer',
        gutter: '.photo-grid-gutter-sizer',
        percentPosition: true,
        transitionDuration: '0.3s',
        initLayout: false // Don't layout immediately, wait for images
    });
    
    // Use imagesLoaded to layout after images load
    if (typeof imagesLoaded !== 'undefined') {
        imagesLoaded(gridElement, function() {
            masonryInstance.layout();
        });
    } else {
        // Fallback if imagesLoaded isn't available
        masonryInstance.layout();
    }
    
    return masonryInstance;
}

// Update masonry layout (for dynamic content)
function updateMasonryLayout() {
    if (masonryInstance) {
        if (typeof imagesLoaded !== 'undefined') {
            imagesLoaded(masonryInstance.element, function() {
                masonryInstance.reloadItems();
                masonryInstance.layout();
            });
        } else {
            masonryInstance.reloadItems();
            masonryInstance.layout();
        }
    }
}

function promptPassword(album) {
    currentGallery = album;
    const modal = document.getElementById('passwordModal');
    modal.style.display = 'flex';
    document.getElementById('albumPasscodeInput').value = '';
    document.getElementById('passwordError').textContent = '';
}

function closePasswordPrompt() {
    document.getElementById('passwordModal').style.display = 'none';
}

function checkAlbumPasscode() {
    const passcode = document.getElementById('albumPasscodeInput').value;
    const errorElement = document.getElementById('passwordError');
    const galleryPass = galleryLookup[currentGallery]?.password || '';
    if (galleryPass && galleryPass === passcode) {
        loadGallery(currentGallery);
        closePasswordPrompt();
        return;
    }
    if (!galleryPass) {
        loadGallery(currentGallery);
        closePasswordPrompt();
        return;
    }
    errorElement.textContent = 'Incorrect passcode. Please try again.';
    document.getElementById('albumPasscodeInput').classList.add('error');
    setTimeout(() => {
        document.getElementById('albumPasscodeInput').classList.remove('error');
    }, 2000);
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

        // Use virtual scrolling for galleries with many images
        // Lower threshold on mobile to improve performance
        const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
        const threshold = isMobile ? 30 : 50;
        const useVirtualScrolling = photos.length > threshold;

        if (useVirtualScrolling) {
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
                <a class="btn btn-primary btn-download" href="${escapeHTML(downloadLink)}">
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
    // Remove any stale listener before adding to prevent leaks
    document.removeEventListener('keydown', handleKeyboardNavigation);
    document.addEventListener('keydown', handleKeyboardNavigation);

    // Load images with data-src for lazy loading
    const imgElements = document.querySelectorAll('.photo-item img');
    imgElements.forEach((imgElement, index) => {
        imgElement.dataset.src = `images/${encodedAlbum}/${encodeURIComponent(photos[index])}`;
    });
    
    // Initialize masonry layout
    const photoGrid = document.getElementById('photoGrid');
    initializeMasonry(photoGrid);
    
    // Initialize lazy loading for gallery images
    initializeLazyLoading();
}

function loadGalleryWithVirtualScrolling(album, photos, downloadLink) {
    const gallery = galleryLookup[album];
    const displayTitle = escapeHTML(gallery ? gallery.title : album);
    const safeId = safeCSSId(album);
    const encodedAlbum = encodeURIComponent(gallery ? gallery.name : album);
    // Adjust batch size based on device and connection
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    const slow = isSlowConnection();
    const BATCH_SIZE = (isMobile || slow) ? 10 : 20;
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
                <a class="btn btn-primary btn-download" href="${escapeHTML(downloadLink)}">
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
    // Remove any stale listener before adding to prevent leaks
    document.removeEventListener('keydown', handleKeyboardNavigation);
    document.addEventListener('keydown', handleKeyboardNavigation);

    const photoGrid = document.getElementById('photoGrid');

    // Function to render a batch of photos
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

        // Initialize masonry on first batch
        if (!masonryInitialized && renderedCount > 0) {
            initializeMasonry(photoGrid);
            masonryInitialized = true;
        } else if (masonryInitialized) {
            // Update masonry layout for new items
            updateMasonryLayout();
        }

        // Initialize lazy loading for new batch
        initializeLazyLoading();

        // Update progress
        const progress = (renderedCount / photos.length) * 100;
        const progressEl = document.getElementById(`progress-${safeId}`);
        const progressBar = progressEl ? progressEl.querySelector('.progress') : null;
        if (progressBar) {
            progressBar.style.width = `${progress}%`;
        }
    }

    // Render initial batch
    renderBatch();

    // Set up scroll observer for infinite loading
    const scrollObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting && renderedCount < photos.length) {
                renderBatch();
            }
        });
    }, {
        rootMargin: '200px' // Load next batch 200px before reaching the end
    });

    // Observe the last element
    const observeLastElement = () => {
        const lastItem = photoGrid.lastElementChild;
        if (lastItem && renderedCount < photos.length) {
            scrollObserver.observe(lastItem);
        }
    };

    // Start observing
    setTimeout(observeLastElement, 100);
    
    // Re-observe when new items are added
    const mutationObserver = new MutationObserver(() => {
        scrollObserver.disconnect();
        observeLastElement();
    });
    
    mutationObserver.observe(photoGrid, { childList: true });
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
    // Destroy masonry instance
    if (masonryInstance) {
        masonryInstance.destroy();
        masonryInstance = null;
    }
    
    document.getElementById('galleryContainer').innerHTML = '';
    document.removeEventListener('keydown', handleKeyboardNavigation);

    // Show the portfolio section again
    const portfolioSection = document.querySelector('.portfolio-section');
    if (portfolioSection) {
        portfolioSection.style.display = '';
        portfolioSection.scrollIntoView({ behavior: 'smooth' });
    }
    closeExitModal();
}

// Lightbox Functions with modern transitions
function openLightbox(index) {
    currentPhotoIndex = index;
    const lightbox = document.getElementById('lightbox');
    
    // Remove closing class if it exists
    lightbox.classList.remove('closing');
    
    // Show lightbox
    lightbox.style.display = 'block';
    
    // Force reflow for animation
    void lightbox.offsetWidth;
    
    // Update counter
    updateLightboxCounter();
    
    // Load and display image
    preloadLightboxImages(index);
    
    // Disable body scroll
    document.body.style.overflow = 'hidden';
}

function preloadLightboxImages(index) {
    const lightboxImage = document.getElementById('lightboxImage');
    
    // Remove loaded class for transition
    lightboxImage.classList.remove('loaded');
    
    // Create a new image to preload
    const tempImg = new Image();
    
    tempImg.onload = () => {
        // Set the source and show with animation
        lightboxImage.src = currentPhotos[index];
        setTimeout(() => {
            lightboxImage.classList.add('loaded');
        }, 50);
    };
    
    tempImg.onerror = () => {
        console.error('Failed to load image:', currentPhotos[index]);
        lightboxImage.src = currentPhotos[index];
        lightboxImage.classList.add('loaded');
    };
    
    // Start loading
    tempImg.src = currentPhotos[index];
    
    // Preload adjacent images for smooth navigation
    const preloadIndices = [
        (index + 1) % currentPhotos.length,
        (index - 1 + currentPhotos.length) % currentPhotos.length
    ];
    
    preloadIndices.forEach(i => {
        const img = new Image();
        img.src = currentPhotos[i];
    });
}

function updateLightboxCounter() {
    const counter = document.getElementById('lightboxCounter');
    if (counter) {
        counter.textContent = `${currentPhotoIndex + 1} / ${currentPhotos.length}`;
    }
}

function closeModal() {
    const lightbox = document.getElementById('lightbox');
    
    // Add closing animation class
    lightbox.classList.add('closing');
    
    // Re-enable body scroll
    document.body.style.overflow = '';
    
    // Hide after animation completes
    setTimeout(() => {
        lightbox.style.display = 'none';
        lightbox.classList.remove('closing');
    }, 300);
}

// Debounce function to limit rapid calls
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

const debouncedNavigatePhoto = debounce((direction) => {
    currentPhotoIndex = (currentPhotoIndex + direction + currentPhotos.length) % currentPhotos.length;
    updateLightboxCounter();
    preloadLightboxImages(currentPhotoIndex);
}, 150);

function navigatePhoto(direction) {
    debouncedNavigatePhoto(direction);
}

function handleKeyboardNavigation(e) {
    if (document.getElementById('lightbox').style.display !== 'none' && document.getElementById('lightbox').style.display !== '') {
        switch(e.key) {
            case 'ArrowLeft':
                navigatePhoto(-1);
                break;
            case 'ArrowRight':
                navigatePhoto(1);
                break;
            case 'Escape':
                closeModal();
                break;
        }
    }
}

// Event Listeners
document.addEventListener('click', function(e) {
    if (e.target.classList.contains('lightbox')) {
        closeModal();
    }
});

// Detect slow connections and adjust behavior
function isSlowConnection() {
    if ('connection' in navigator) {
        const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
        if (connection) {
            // Check if connection is slow (2G or slow-2g)
            const slowTypes = ['slow-2g', '2g'];
            if (slowTypes.includes(connection.effectiveType)) {
                return true;
            }
            // Also consider saveData preference
            if (connection.saveData) {
                return true;
            }
        }
    }
    return false;
}

// Log performance info for debugging
function logPerformanceInfo() {
    // Keep this lightweight to avoid blocking first paint
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    console.log('Device Info:', {
        isMobile,
        userAgent: navigator.userAgent,
        connection: connection ? {
            effectiveType: connection.effectiveType,
            downlink: connection.downlink,
            rtt: connection.rtt,
            saveData: connection.saveData
        } : 'Not available',
        viewport: {
            width: window.innerWidth,
            height: window.innerHeight
        },
        supportsIntersectionObserver: 'IntersectionObserver' in window
    });
}

// Adjust observer behavior for slow connections
function getOptimalObserverSettings() {
    const slow = isSlowConnection();
    return {
        rootMargin: slow ? '200px' : '100px',
        threshold: slow ? 0.1 : 0.01
    };
}

document.addEventListener('DOMContentLoaded', async () => {
    // Defer non-critical logging so it doesn't block the main thread
    const deferLog = window.requestIdleCallback || ((cb) => setTimeout(cb, 150));
    deferLog(logPerformanceInfo);
    
    // Add mobile-specific optimizations
    if ('ontouchstart' in window) {
        document.body.classList.add('touch-device');
    }
    
    // Prevent double-tap zoom only on interactive elements, not the whole page
    document.addEventListener('touchend', function (event) {
        if (event.target.closest && event.target.closest('button, .btn, .album-card')) {
            const now = Date.now();
            if (now - (event.target._lastTouchEnd || 0) <= 300) {
                event.preventDefault();
            }
            event.target._lastTouchEnd = now;
        }
    }, { passive: false });
    
    await loadGalleries();
    
    // Register service worker for better offline support (future enhancement)
    if ('serviceWorker' in navigator) {
        // Uncomment when service worker is implemented
        // navigator.serviceWorker.register('/sw.js').catch(err => console.log('SW registration failed:', err));
    }
});

// Initialize
document.getElementById('albumPasscodeInput').addEventListener('keypress', function(e) {
    if (e.key === 'Enter') checkAlbumPasscode();
});