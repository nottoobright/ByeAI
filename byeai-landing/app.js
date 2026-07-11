const installBtn = document.getElementById('install-btn');

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', function() {
    initializeApp();
    console.log("ByeAI Landing Page Loaded");
});

function initializeApp() {
    setupSmoothScrolling();
    setupInstallButton();
    setupScrollAnimations();
    setupInteractiveEffects();
    setupParallax();
}

// Smooth scrolling for anchor links
function setupSmoothScrolling() {
    // Handle all anchor links
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function (e) {
            e.preventDefault();
            const targetId = this.getAttribute('href');
            const target = document.querySelector(targetId);
            
            if (target) {
                const headerHeight = document.querySelector('.header').offsetHeight;
                const targetPosition = target.offsetTop - headerHeight - 20;
                
                window.scrollTo({
                    top: targetPosition,
                    behavior: 'smooth'
                });
            }
        });
    });

    // Specifically handle the Learn More button
    const learnMoreBtn = document.querySelector('a[href="#features"]');
    if (learnMoreBtn) {
        learnMoreBtn.addEventListener('click', function(e) {
            e.preventDefault();
            const featuresSection = document.getElementById('features');
            if (featuresSection) {
                const headerHeight = document.querySelector('.header').offsetHeight;
                const targetPosition = featuresSection.offsetTop - headerHeight - 20;
                
                window.scrollTo({
                    top: targetPosition,
                    behavior: 'smooth'
                });
            }
        });
    }
}

// Setup install button
function setupInstallButton() {
    if (installBtn) {
        // Make the hero install button clickable and scroll to the CTA section
        installBtn.disabled = false;
        installBtn.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            const installSection = document.getElementById('install');
            if (installSection) {
                installSection.scrollIntoView({ behavior: 'smooth' });
            }
        });
    }
}

// Scroll animation for feature cards
function setupScrollAnimations() {
    const featureCards = document.querySelectorAll('.feature-card');
    
    const observer = new IntersectionObserver((entries) => {
        entries.forEach((entry, index) => {
            if (entry.isIntersecting) {
                setTimeout(() => {
                    entry.target.classList.add('animate');
                }, index * 100); // Staggered animation
            }
        });
    }, {
        threshold: 0.1,
        rootMargin: '50px'
    });

    featureCards.forEach(card => {
        observer.observe(card);
    });
}

// Setup interactive effects
function setupInteractiveEffects() {
    // Add interactive feedback for nav links
    const navLinks = document.querySelectorAll('.nav-links a');
    navLinks.forEach(link => {
        link.addEventListener('mouseenter', function() {
            this.style.transform = 'translateY(-2px)';
        });
        
        link.addEventListener('mouseleave', function() {
            this.style.transform = 'translateY(0)';
        });
    });
    
    // Add hover effect to logo
    const logo = document.querySelector('.logo h1');
    if (logo) {
        logo.addEventListener('mouseenter', function() {
            this.style.transform = 'scale(1.05)';
        });
        
        logo.addEventListener('mouseleave', function() {
            this.style.transform = 'scale(1)';
        });
    }

    // Add smooth transitions for buttons
    document.querySelectorAll('.btn').forEach(btn => {
        btn.addEventListener('mouseenter', function() {
            this.style.transition = 'all 0.2s ease';
        });
    });
}

// Add parallax effect to hero section on scroll
function setupParallax() {
    window.addEventListener('scroll', throttle(function() {
        const scrolled = window.pageYOffset;
        const hero = document.querySelector('.hero');
        const heroContent = document.querySelector('.hero-content');
        const heroVisual = document.querySelector('.hero-visual');
        
        if (hero && scrolled < hero.offsetHeight) {
            const rate = scrolled * -0.5;
            if (heroContent) {
                heroContent.style.transform = `translateY(${rate * 0.5}px)`;
            }
            if (heroVisual) {
                heroVisual.style.transform = `translateY(${rate * 0.3}px)`;
            }
        }
    }, 16));
}

// Performance optimization: Throttle scroll events
function throttle(func, limit) {
    let inThrottle;
    return function() {
        const args = arguments;
        const context = this;
        if (!inThrottle) {
            func.apply(context, args);
            inThrottle = true;
            setTimeout(() => inThrottle = false, limit);
        }
    }
}

// Add smooth scrolling fallback for older browsers
if (!CSS.supports('scroll-behavior', 'smooth')) {
    function smoothScrollPolyfill(target) {
        const startPosition = window.pageYOffset;
        const targetPosition = target.offsetTop - document.querySelector('.header').offsetHeight - 20;
        const distance = targetPosition - startPosition;
        const duration = 500;
        let start = null;
        
        function animation(currentTime) {
            if (start === null) start = currentTime;
            const timeElapsed = currentTime - start;
            const run = ease(timeElapsed, startPosition, distance, duration);
            window.scrollTo(0, run);
            if (timeElapsed < duration) requestAnimationFrame(animation);
        }
        
        function ease(t, b, c, d) {
            t /= d / 2;
            if (t < 1) return c / 2 * t * t + b;
            t--;
            return -c / 2 * (t * (t - 2) - 1) + b;
        }
        
        requestAnimationFrame(animation);
    }
    
    // Override smooth scrolling for unsupported browsers
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function (e) {
            e.preventDefault();
            const target = document.querySelector(this.getAttribute('href'));
            if (target) {
                smoothScrollPolyfill(target);
            }
        });
    });
}