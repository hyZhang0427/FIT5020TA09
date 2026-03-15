<!--
  UVTracker.vue: Root orchestrator for the UV Index tracker.
  Manages state, API calls, and composes child components.
-->

<script setup>
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { useScrollReveal } from '@/composables/useScrollReveal'
import { uvLevels, victoriaLocations, skinTypes } from '../data/uvConstants.js'
import UVGauge from './UVGauge.vue'
import StatusCard from './StatusCard.vue'
import TipsCard from './TipsCard.vue'
import SkinSelector from './SkinSelector.vue'
import SkinAdviceCard from './SkinAdviceCard.vue'
import UVAbsorptionCard from './UVAbsorptionCard.vue'
import LocationModal from './LocationModal.vue'
import SkinMythsCard from './SkinMythsCard.vue'
import SectionNav from './SectionNav.vue'
import UVTimelineCard from './UVTimelineCard.vue'
import UVTrendChart from './UVTrendChart.vue'
import SkinCancerImpactChart from './SkinCancerImpactChart.vue'
import { AlertTriangle, BookOpen } from 'lucide-vue-next'

// ==== REACTIVE STATE ====
const uvIndex = ref(null)
const loading = ref(false)
const error = ref(false)
const errorMessage = ref('')
const showData = ref(false)
const locationName = ref('Your Location')
const currentLat = ref(null)
const currentLon = ref(null)
const isDenied = ref(false)
const fallbackNotice = ref('')
const showLocationSearch = ref(false)
const locationSearchResults = ref([])
const isSearchingLocations = ref(false)
const hourlyForecast = ref([])
const sliderToneIndex = ref(3)
const selectedSkinType = ref(null)
const lastUpdated = ref(null)
const reverseGeoCache = new Map()
const locationSearchCache = new Map()
const uvDataCache = new Map()
const searchAbortController = ref(null)

const CACHE_TTL_MS = 10 * 60 * 1000
const UV_CACHE_TTL_MS = 2 * 60 * 1000
const sectionNavItems = [
  { id: 'uv-index-section', label: 'UV Index' },
  { id: 'status-section', label: 'Status' },
  { id: 'tips-section', label: 'Tips' },
  { id: 'skin-section', label: 'Personal Path' },
  { id: 'myths-section', label: 'Myths' },
]
const activeNavId = ref('uv-index-section')

const orderedToneKeys = ['fair', 'light', 'medium', 'olive', 'dark']
const STORAGE_KEY = 'sunsafe-vic-skin-tone'

useScrollReveal()

// ==== COMPUTED PROPERTIES ====

const currentUVLevel = computed(() => {
  if (uvIndex.value === null) return null
  return Math.round(uvIndex.value)
})

const uvColor = computed(() => {
  if (currentUVLevel.value === null) return uvLevels[0]
  const clamped = Math.min(Math.max(currentUVLevel.value, 0), 11)
  return uvLevels[clamped]
})

const uvSeverity = computed(() => {
  if (currentUVLevel.value === null) return 'low'
  const level = currentUVLevel.value
  if (level <= 2) return 'low'
  if (level <= 5) return 'moderate'
  if (level <= 7) return 'high'
  if (level <= 10) return 'veryhigh'
  return 'extreme'
})

const uvColorRgb = computed(() => {
  if (currentUVLevel.value === null) return '108, 99, 255'
  const c = uvColor.value.bg
  return `${parseInt(c.slice(1, 3), 16)}, ${parseInt(c.slice(3, 5), 16)}, ${parseInt(c.slice(5, 7), 16)}`
})

const auraCenter = computed(() => {
  const level = currentUVLevel.value ?? 0
  if (level <= 2) return '20% 30%'
  if (level <= 5) return '40% 15%'
  if (level <= 7) return '50% 10%'
  return '50% 5%'
})

const isHighUvPulse = computed(() => (currentUVLevel.value ?? 0) >= 8)

const trackerRootStyle = computed(() => ({
  backgroundImage: rootBackground.value,
}))

const dataAuraStyle = computed(() => ({
  background: `radial-gradient(ellipse 70% 55% at ${auraCenter.value}, rgba(${uvColorRgb.value}, 0.22) 0%, rgba(${uvColorRgb.value}, 0) 70%), radial-gradient(ellipse 45% 40% at 20% 30%, rgba(${uvColorRgb.value}, 0.10) 0%, rgba(${uvColorRgb.value}, 0) 60%), #ffffff`,
}))

const rootBackground = computed(() => {
  if (currentUVLevel.value === null) return 'linear-gradient(180deg, #ffffff 0%, #ffffff 100%)'
  return 'linear-gradient(180deg, #ffffff 0%, #ffffff 100%)'
})

// Tick counter to make timeAgo reactive
const tick = ref(0)
let tickTimer = null
onMounted(() => {
  tickTimer = setInterval(() => tick.value++, 30000)
})
onUnmounted(() => {
  clearInterval(tickTimer)
})

const timeAgo = computed(() => {
  void tick.value
  if (!lastUpdated.value) return ''
  const diff = Math.round((Date.now() - lastUpdated.value.getTime()) / 60000)
  if (diff < 1) return 'Updated just now'
  if (diff === 1) return 'Updated 1 min ago'
  return `Updated ${diff} min ago`
})

function isVictoriaCoordinate(lat, lon) {
  return lat >= -39.3 && lat <= -33.9 && lon >= 140.9 && lon <= 150.1
}

function getCachedItem(cache, key) {
  const cached = cache.get(key)
  if (!cached) return null
  if (Date.now() - cached.timestamp > CACHE_TTL_MS) {
    cache.delete(key)
    return null
  }
  return cached.value
}

function setCachedItem(cache, key, value) {
  cache.set(key, { value, timestamp: Date.now() })
}

function applyUvPayload(data, lat, lon) {
  uvIndex.value = data.current.uvi
  hourlyForecast.value = Array.isArray(data?.hourly)
    ? data.hourly.filter((entry) => typeof entry?.uvi === 'number' && typeof entry?.dt === 'number')
    : []
  currentLat.value = lat
  currentLon.value = lon
  showData.value = true
  showLocationSearch.value = false
  lastUpdated.value = new Date()
}

// ==== API CALLS ====

async function fetchUVData(lat, lon, preferredName = '') {
  try {
    loading.value = true
    error.value = false
    errorMessage.value = ''

    const cacheKey = `${lat.toFixed(2)},${lon.toFixed(2)}`
    const cachedPayload = getCachedItem(uvDataCache, cacheKey)
    if (cachedPayload) {
      applyUvPayload(cachedPayload, lat, lon)
      reverseGeocode(lat, lon, preferredName)
      return
    }

    const apiKey = import.meta.env.VITE_OWM_KEY

    if (!apiKey) {
      throw new Error('Missing OpenWeatherMap API key. Add VITE_OWM_KEY to your .env file.')
    }

    const url = `https://api.openweathermap.org/data/3.0/onecall?lat=${lat}&lon=${lon}&exclude=minutely,daily,alerts&appid=${apiKey}`

    console.log('onecall request:', url)

    const response = await fetch(url)
    const data = await response.json().catch(() => null)

    if (!response.ok) {
      throw new Error(
        `One Call request failed (${response.status}): ${data?.message || 'Unknown API error'}`
      )
    }

    if (typeof data?.current?.uvi !== 'number') {
      throw new Error('UV data missing in API response')
    }

    setCachedItem(uvDataCache, cacheKey, data)
    applyUvPayload(data, lat, lon)

    reverseGeocode(lat, lon, preferredName)
  } catch (err) {
    const message = err instanceof Error ? err.message : ''

    console.error('fetchUVData error:', err)

    if (message.includes('Missing OpenWeatherMap API key')) {
      errorMessage.value = 'API key is missing. Add VITE_OWM_KEY to your .env file.'
    } else if (message.includes('401') && message.toLowerCase().includes('one call')) {
      errorMessage.value =
        'Your OpenWeather key does not have access to One Call 3.0 yet. Check your subscription.'
    } else if (message.includes('401')) {
      errorMessage.value =
        'Unauthorized request. Please check that your OpenWeather API key is correct and active.'
    } else if (message.includes('429')) {
      errorMessage.value = 'Too many requests right now. Please try again in a moment.'
    } else {
      errorMessage.value = message || 'Unable to fetch UV data. Please try again.'
    }

    error.value = true
    showData.value = false
  } finally {
    loading.value = false
  }
}

function normalizeVicName(placeName) {
  if (!placeName) return 'Unknown, VIC'
  const cleaned = placeName
    .replace(/^Rural City of\s+/i, '')
    .replace(/^City of\s+/i, '')
    .replace(/^Shire of\s+/i, '')
    .trim()
  return `${cleaned}, VIC`
}

function pickMostPreciseLocation(entries) {
  if (!entries?.length) return null

  const administrativePattern = /shire|city of|municipality|region|council|district/i
  const ranked = entries
    .filter((item) => item?.name)
    .map((item) => {
      const name = item.name.trim()
      let score = 10
      if (item.state === 'Victoria') score += 4
      if (!administrativePattern.test(name)) score += 6
      if (name.split(' ').length <= 2) score += 2
      score -= Math.min(name.length * 0.06, 3)
      return { item, score }
    })
    .sort((a, b) => b.score - a.score)

  return ranked[0]?.item ?? entries[0]
}

async function reverseGeocode(lat, lon, preferredName = '') {
  try {
    const cacheKey = `${lat.toFixed(3)},${lon.toFixed(3)}`
    const cached = getCachedItem(reverseGeoCache, cacheKey)
    if (cached) {
      locationName.value = cached
      return
    }

    const apiKey = import.meta.env.VITE_OWM_KEY
    if (!apiKey) {
      throw new Error('Missing OpenWeatherMap API key')
    }

    const url = `https://api.openweathermap.org/geo/1.0/reverse?lat=${lat}&lon=${lon}&limit=5&appid=${apiKey}`
    console.log('reverse request:', url)

    const response = await fetch(url)
    const data = await response.json().catch(() => null)

    if (!response.ok) {
      throw new Error(
        `Reverse geocode failed (${response.status}): ${data?.message || 'Unknown API error'}`
      )
    }

    const best = pickMostPreciseLocation(data)
    if (best?.name) {
      const resolvedName = normalizeVicName(best.name)
      locationName.value = resolvedName
      setCachedItem(reverseGeoCache, cacheKey, resolvedName)
      return
    }

    if (preferredName) {
      locationName.value = preferredName
    }
  } catch (err) {
    console.error('reverseGeocode error:', err)
    locationName.value = preferredName || 'Your Location'
  }
}
async function searchVictoriaLocations(query) {
  const normalized = query.trim()
  if (normalized.length < 2) {
    locationSearchResults.value = []
    return
  }

  const cacheKey = normalized.toLowerCase()
  const cached = getCachedItem(locationSearchCache, cacheKey)
  if (cached) {
    locationSearchResults.value = cached
    return
  }

  if (searchAbortController.value) {
    searchAbortController.value.abort()
  }

  const controller = new AbortController()
  searchAbortController.value = controller
  isSearchingLocations.value = true

  try {
    const apiKey = import.meta.env.VITE_OWM_KEY
    if (!apiKey) {
      throw new Error('Missing OpenWeatherMap API key')
    }

    const isPostcode = /^\d{4}$/.test(normalized)
    let results = []

    if (isPostcode) {
      const zipUrl = `https://api.openweathermap.org/geo/1.0/zip?zip=${normalized},AU&appid=${apiKey}`
      console.log('zip request:', zipUrl)

      const response = await fetch(zipUrl, { signal: controller.signal })
      const data = await response.json().catch(() => null)

      if (!response.ok) {
        throw new Error(
          `ZIP lookup failed (${response.status}): ${data?.message || 'Unknown API error'}`
        )
      }

      if (isVictoriaCoordinate(data.lat, data.lon)) {
        const reverseUrl = `https://api.openweathermap.org/geo/1.0/reverse?lat=${data.lat}&lon=${data.lon}&limit=5&appid=${apiKey}`
        console.log('reverse from zip request:', reverseUrl)

        const reverseResp = await fetch(reverseUrl, { signal: controller.signal })
        const reverseData = reverseResp.ok ? await reverseResp.json() : []
        const best = pickMostPreciseLocation(reverseData)
        const name = best?.name ? normalizeVicName(best.name) : normalizeVicName(data.name)
        results = [{ name, lat: data.lat, lon: data.lon }]
      }
    } else {
      const directUrl = `https://api.openweathermap.org/geo/1.0/direct?q=${encodeURIComponent(`${normalized},AU`)}&limit=8&appid=${apiKey}`
      console.log('direct request:', directUrl)

      const response = await fetch(directUrl, { signal: controller.signal })
      const data = await response.json().catch(() => null)

      if (!response.ok) {
        throw new Error(
          `Direct geocode failed (${response.status}): ${data?.message || 'Unknown API error'}`
        )
      }

      results = data
        .filter((item) => item.state === 'Victoria' || isVictoriaCoordinate(item.lat, item.lon))
        .map((item) => ({
          name: normalizeVicName(item.name),
          lat: item.lat,
          lon: item.lon,
        }))
    }

    const deduped = [...new Map(results.map((item) => [`${item.lat}-${item.lon}`, item])).values()]
    locationSearchResults.value = deduped
    setCachedItem(locationSearchCache, cacheKey, deduped)
  } catch (err) {
    if (!(err instanceof DOMException && err.name === 'AbortError')) {
      console.error('searchVictoriaLocations error:', err)
      locationSearchResults.value = []
    }
  } finally {
    if (searchAbortController.value === controller) {
      isSearchingLocations.value = false
      searchAbortController.value = null
    }
  }
}

function handleLocationSearchQuery(query) {
  searchVictoriaLocations(query)
}

function handleSliderToneChange(nextIndex) {
  sliderToneIndex.value = Math.max(1, Math.min(5, nextIndex))
}

function handleSkinConfirm() {
  const selectedKey = orderedToneKeys[sliderToneIndex.value - 1]
  selectedSkinType.value = selectedKey
  localStorage.setItem(STORAGE_KEY, selectedKey)
}

function handleSkinReset() {
  sliderToneIndex.value = 3
  selectedSkinType.value = null
  localStorage.removeItem(STORAGE_KEY)
}

// ==== USER INTERACTIONS ====

function requestLocationAndFetch() {
  if (!navigator.geolocation) {
    useFallbackLocation('Location unavailable. Showing default UV for Melbourne CBD.')
    return
  }

  loading.value = true

  navigator.geolocation.getCurrentPosition(
    (position) => {
      const { latitude, longitude } = position.coords
      isDenied.value = false
      fallbackNotice.value = ''
      fetchUVData(latitude, longitude)
    },
    (geoError) => {
      isDenied.value = geoError.code === geoError.PERMISSION_DENIED
      const notice =
        geoError.code === geoError.PERMISSION_DENIED
          ? 'Location permission denied. Showing default UV for Melbourne CBD.'
          : 'Location unavailable. Showing default UV for Melbourne CBD.'
      useFallbackLocation(notice)
    },
    { enableHighAccuracy: false, timeout: 4500, maximumAge: 300000 },
  )
}

function useFallbackLocation(notice = 'Showing default UV for Melbourne CBD.') {
  const melbourne = victoriaLocations[0]
  locationName.value = melbourne.name
  fallbackNotice.value = notice
  fetchUVData(melbourne.lat, melbourne.lon)
}

function handleLocationSelect(location) {
  isDenied.value = false
  fallbackNotice.value = ''
  locationSearchResults.value = []
  locationName.value = location.name
  fetchUVData(location.lat, location.lon, location.name)
}

function toggleLocationSearch() {
  showLocationSearch.value = !showLocationSearch.value
}

function handleRefresh() {
  showData.value = false
  isDenied.value = false
  fallbackNotice.value = ''
  requestLocationAndFetch()
}

function syncActiveSectionFromScroll() {
  if (!showData.value || loading.value || error.value) return

  const orderedIds = [
    'uv-index-section',
    'status-section',
    'tips-section',
    'skin-section',
    'myths-section',
  ]
  const anchorY = 170
  let closestId = orderedIds[0]
  let closestDist = Number.POSITIVE_INFINITY

  for (const id of orderedIds) {
    const el = document.getElementById(id)
    if (!el) continue
    const dist = Math.abs(el.getBoundingClientRect().top - anchorY)
    if (dist < closestDist) {
      closestDist = dist
      closestId = id
    }
  }

  activeNavId.value = closestId
}

function onScrollSyncNav() {
  syncActiveSectionFromScroll()
}

onUnmounted(() => {
  if (searchAbortController.value) {
    searchAbortController.value.abort()
  }
})

onMounted(() => {
  const cachedSkinType = localStorage.getItem(STORAGE_KEY)
  if (!cachedSkinType || !orderedToneKeys.includes(cachedSkinType)) return
  sliderToneIndex.value = orderedToneKeys.indexOf(cachedSkinType) + 1
  selectedSkinType.value = cachedSkinType
})

onMounted(() => {
  window.addEventListener('scroll', onScrollSyncNav, { passive: true })
})

onUnmounted(() => {
  window.removeEventListener('scroll', onScrollSyncNav)
})

watch([showData, loading, error], () => {
  requestAnimationFrame(syncActiveSectionFromScroll)
})
</script>

<template>
  <div class="uv-tracker-root" :style="trackerRootStyle">
    <div v-if="!showData && !loading && !error" class="prelaunch-video-layer" aria-hidden="true">
      <video class="prelaunch-video" autoplay muted loop playsinline preload="metadata">
        <source
          src="https://videos.pexels.com/video-files/855272/855272-hd_1920_1080_25fps.mp4"
          type="video/mp4"
        />
      </video>
      <div class="prelaunch-video-mask"></div>
    </div>

    <div
      v-if="showData && !loading && !error"
      class="data-atmosphere-layer"
      :class="{ pulse: isHighUvPulse }"
      :style="dataAuraStyle"
      aria-hidden="true"
    ></div>

    <header class="top-banner">
      <p class="banner-title">SunSafe Victoria</p>
      <p class="banner-tagline">Know Your UV, Own Your Day</p>
    </header>

    <!-- Decorative Clouds -->
    <div v-if="false" class="deco-clouds" aria-hidden="true">
      <div class="cloud cloud-1"></div>
      <div class="cloud cloud-2"></div>
      <div class="cloud cloud-3"></div>
    </div>

    <div v-if="false" class="deco-aurora" aria-hidden="true">
      <span class="aurora a1"></span>
      <span class="aurora a2"></span>
      <span class="aurora a3"></span>
    </div>

    <div v-if="false" class="deco-glow" aria-hidden="true">
      <span class="glow g1"></span>
      <span class="glow g2"></span>
      <span class="glow g3"></span>
    </div>

    <!-- Header -->
    <div v-if="showData" class="header-section">
      <p class="subtitle compact">Live UV, skin tips, myths, and quick actions in one place.</p>
    </div>

    <div v-if="showData && !loading && !error" class="location-strip">
      <div class="location-info-inline">
        <p class="location-label-inline">{{ isDenied ? 'Melbourne CBD' : locationName }}</p>
        <button class="btn-change-location-inline" @click="toggleLocationSearch">Change</button>
      </div>
      <p v-if="fallbackNotice" class="location-fallback-note">{{ fallbackNotice }}</p>
    </div>

    <div
      id="uv-index-section"
      class="dashboard-row"
      :class="{ live: showData && !loading && !error }"
    >
      <UVGauge
        :current-u-v-level="currentUVLevel"
        :uv-color="uvColor"
        :show-data="showData"
        :location-name="locationName"
        :is-denied="isDenied"
        :fallback-notice="fallbackNotice"
        :loading="loading"
        :error="error"
        @request-location="requestLocationAndFetch"
      />

      <section v-if="showData && !loading && !error" id="timeline-section" class="timeline-inline">
        <UVTimelineCard :hourly-data="hourlyForecast" :bare="true" />
      </section>
    </div>

    <SectionNav
      v-if="showData && !loading && !error"
      :items="sectionNavItems"
      :active-id="activeNavId"
      :accent-rgb="uvColorRgb"
    />

    <!-- Content -->
    <div v-if="loading || error || showData" class="content-section">
      <!-- Loading -->
      <div v-if="loading" class="loading-container">
        <div class="loading-scene" aria-hidden="true">
          <div class="loading-sun"></div>
          <div class="loading-cloud"></div>
          <div class="loading-ring">
            <span class="loading-dot d1"></span>
            <span class="loading-dot d2"></span>
            <span class="loading-dot d3"></span>
          </div>
        </div>
        <p class="loading-text">Scanning the sky for your UV snapshot...</p>
        <p class="loading-subtext">
          Almost there. Building your personalised sun-safety dashboard.
        </p>
      </div>

      <!-- Error -->
      <div v-if="error" class="error-container">
        <img
          src="/illustrations/error-uv.svg"
          alt="Error illustration"
          class="state-illustration"
        />
        <AlertTriangle :size="30" class="state-icon error" aria-hidden="true" />
        <p class="error-message">{{ errorMessage }}</p>
        <button class="btn btn-secondary" @click="handleRefresh">Retry</button>
      </div>

      <!-- Data Display -->
      <div v-if="showData && !loading && !error" class="data-container">
        <section id="status-section" class="section-block reveal">
          <StatusCard :uv-level="currentUVLevel" :uv-color="uvColor" :uv-color-rgb="uvColorRgb" />
        </section>

        <section id="tips-section" class="section-block reveal delay-1">
          <TipsCard :uv-level="currentUVLevel" :uv-severity="uvSeverity" />
        </section>

        <!-- UV Trend Visualization: UV Intensity and Heat Index in Melbourne over the Past 5 Years -->
        <section id="trend-section" class="section-block reveal delay-1">
          <UVTrendChart />
        </section>

        <!-- Skin Cancer Impact Visualization: Melanoma Risk Over Time -->
        <section id="skin-cancer-impact-section" class="section-block reveal delay-1">
          <SkinCancerImpactChart />
        </section>

        <section id="skin-section" class="section-block personal-path reveal delay-2">
          <div class="skin-flow-card">
            <p class="rail-kicker">Personal Path</p>
            <p class="rail-title">Skin Tone and Absorption</p>
            <ol class="rail-list">
              <li>Pick your skin tone</li>
              <li>Review UV absorption load</li>
            </ol>

            <div class="path-top-grid">
              <div class="path-skin-slot">
                <SkinSelector
                  :slider-index="sliderToneIndex"
                  :selected-type="selectedSkinType"
                  @slider-change="handleSliderToneChange"
                  @confirm="handleSkinConfirm"
                  @reset="handleSkinReset"
                />
              </div>

              <div
                id="absorption-section"
                class="path-absorption-slot"
                :class="{ empty: !selectedSkinType }"
              >
                <UVAbsorptionCard
                  v-if="selectedSkinType"
                  :uv-level="currentUVLevel"
                  :skin-type-key="selectedSkinType"
                />
                <p v-else class="slot-placeholder">
                  Select a skin tone to view UV absorption report.
                </p>
              </div>
            </div>
          </div>
        </section>

        <section v-if="selectedSkinType" id="advice-section" class="section-block reveal delay-1">
          <SkinAdviceCard :skin-type="skinTypes[selectedSkinType]" :uv-level="currentUVLevel" />
        </section>

        <section id="myths-section" class="section-block reveal delay-2">
          <SkinMythsCard />
        </section>

        <!-- Refresh -->
        <div class="refresh-row reveal delay-3">
          <span v-if="lastUpdated" class="time-ago">{{ timeAgo }}</span>
          <button
            class="btn btn-primary"
            :style="{ '--cta-rgb': uvColorRgb }"
            @click="handleRefresh"
          >
            Get Latest UV Update
          </button>
        </div>

        <footer class="trust-source reveal delay-3" aria-label="Data and advice sources">
          <BookOpen :size="14" aria-hidden="true" />
          Data: OpenWeather One Call API · Guidance: Cancer Council Australia, WHO, Australian
          Radiation Protection and Nuclear Safety Agency.
        </footer>
      </div>
    </div>

    <!-- Location Modal -->
    <LocationModal
      :show="showLocationSearch"
      :locations="victoriaLocations"
      :online-results="locationSearchResults"
      :searching="isSearchingLocations"
      :current-lat="currentLat"
      :current-lon="currentLon"
      @select="handleLocationSelect"
      @search-query="handleLocationSearchQuery"
      @close="toggleLocationSearch"
    />
  </div>
</template>

<style scoped>
* {
  box-sizing: border-box;
}

.uv-tracker-root {
  --motion-fast: 180ms;
  --motion-medium: 420ms;
  --motion-slow: 1400ms;
  --ease-emphasis: cubic-bezier(0.22, 1, 0.36, 1);
  --page-pad: 20px;
  width: 100%;
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  padding: 64px 0 0;
  position: relative;
  overflow: hidden;
  transition: background 0.8s ease;
  font-family:
    'DM Sans',
    'Plus Jakarta Sans',
    -apple-system,
    BlinkMacSystemFont,
    'Segoe UI',
    sans-serif;
  background-size: cover;
  background-attachment: scroll;
  background-color: #f4f7ea;
}

.prelaunch-video-layer {
  position: absolute;
  inset: 0;
  z-index: 0;
  overflow: hidden;
}

.prelaunch-video {
  width: 100%;
  height: 100%;
  object-fit: cover;
  transform: scale(1.06);
}

.prelaunch-video-mask {
  position: absolute;
  inset: 0;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.58), rgba(255, 255, 255, 0.4));
}

.data-atmosphere-layer {
  position: absolute;
  inset: 0;
  z-index: 0;
  transition: background 1.2s ease;
  pointer-events: none;
}

@media (prefers-reduced-motion: no-preference) {
  .data-atmosphere-layer.pulse {
    animation: uvAuraPulse 3.5s ease-in-out infinite;
  }
}

@keyframes uvAuraPulse {
  0%,
  100% {
    opacity: 0.85;
  }
  50% {
    opacity: 1;
  }
}

.top-banner {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 12;
  padding: 8px 24px 7px;
  text-align: center;
  border-bottom: none;
  background: transparent;
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
  box-shadow: none;
  overflow: hidden;
}

.banner-title {
  margin: 0;
  font-size: 1rem;
  font-family: 'Sora', 'DM Sans', 'Plus Jakarta Sans', sans-serif;
  font-weight: 700;
  letter-spacing: 0.2px;
  color: #2c3d58;
}

.banner-tagline {
  margin: 1px 0 0;
  font-size: 0.72rem;
  font-weight: 400;
  letter-spacing: 0.2px;
  color: rgba(79, 99, 131, 0.7);
}

/* Header */
.header-section {
  padding: 2px 20px 10px;
  text-align: center;
  position: relative;
  z-index: 1;
}

.subtitle {
  font-size: 0.86rem;
  font-weight: 500;
  margin: 0;
  color: #24324a;
  line-height: 1.5;
  text-wrap: balance;
}

.subtitle.compact {
  font-size: 0.78rem;
  font-weight: 600;
  color: rgba(51, 65, 85, 0.9);
}

.permission-note {
  display: inline-block;
  font-size: 0.72rem;
  color: #374151;
  margin: 7px 0 0;
  font-style: normal;
  padding: 3px 8px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.7);
  border: 1px solid rgba(255, 255, 255, 0.92);
}

.location-strip {
  width: min(1320px, 100%);
  margin: 0 auto 6px;
  padding-inline: var(--page-pad);
  padding: 8px 6px;
  box-sizing: border-box;
  border-bottom: 1px solid rgba(148, 163, 184, 0.35);
  background: rgba(255, 255, 255, 0.36);
  backdrop-filter: blur(3px);
  -webkit-backdrop-filter: blur(3px);
  display: grid;
  gap: 4px;
}

.location-info-inline {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.location-label-inline {
  margin: 0;
  font-size: 0.84rem;
  color: #1f2937;
  font-weight: 700;
}

.btn-change-location-inline {
  padding: 8px 12px;
  font-size: 0.8rem;
  border: 1px solid #60a5fa;
  background: #ffffff;
  color: #1e40af;
  border-radius: 10px;
  cursor: pointer;
  font-weight: 800;
  font-family: inherit;
  box-shadow: 0 2px 8px rgba(30, 64, 175, 0.14);
}

.btn-change-location-inline:hover {
  background: #eff6ff;
  border-color: #3b82f6;
}

.btn-change-location-inline:focus-visible {
  outline: 2px solid #1d4ed8;
  outline-offset: 2px;
}

.location-fallback-note {
  margin: 0;
  font-size: 0.76rem;
  color: #64748b;
}

.dashboard-row {
  width: min(1320px, 100%);
  margin: 0 auto;
  padding-inline: var(--page-pad);
  box-sizing: border-box;
  display: block;
}

.dashboard-row.live {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  align-items: stretch;
  gap: 10px;
  padding-top: 2px;
  padding-bottom: 2px;
  margin-bottom: 1px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.07);
}

#uv-index-section {
  scroll-margin-top: 88px;
}

.timeline-inline {
  border: 0;
  border-left: 1px solid rgba(0, 0, 0, 0.07);
  border-radius: 0;
  background: transparent;
  box-shadow: none;
  padding: 0 0 0 14px;
  min-height: 252px;
  min-width: 0;
  align-self: end;
}

/* Content */
.content-section {
  flex: 1;
  padding: 4px 10px 128px;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  position: relative;
  z-index: 1;
}

/* Loading */
.loading-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  margin: 80px auto;
}

.state-icon.error {
  color: #b91c1c;
}

.loading-scene {
  width: 126px;
  height: 84px;
  position: relative;
}

.loading-sun {
  position: absolute;
  top: 4px;
  left: 10px;
  width: 30px;
  height: 30px;
  border-radius: 50%;
  background: radial-gradient(circle, #fde047 0%, #f59e0b 88%);
  box-shadow: 0 0 0 8px rgba(245, 158, 11, 0.2);
  animation: sunPulse var(--motion-slow) ease-in-out infinite;
}

.loading-cloud {
  position: absolute;
  left: 20px;
  top: 34px;
  width: 68px;
  height: 24px;
  border-radius: 999px;
  background: #dbe3ef;
}

.loading-cloud::before,
.loading-cloud::after {
  content: '';
  position: absolute;
  border-radius: 50%;
  background: #dbe3ef;
}

.loading-cloud::before {
  width: 24px;
  height: 24px;
  left: 10px;
  top: -12px;
}

.loading-cloud::after {
  width: 30px;
  height: 30px;
  left: 32px;
  top: -16px;
}

.loading-ring {
  position: absolute;
  right: 2px;
  bottom: 2px;
  width: 48px;
  height: 48px;
  border-radius: 50%;
  border: 2px dashed rgba(15, 118, 110, 0.35);
  animation: spin calc(var(--motion-slow) * 3.2) linear infinite;
}

.loading-dot {
  position: absolute;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #0f766e;
}

.loading-dot.d1 {
  left: 20px;
  top: -3px;
}

.loading-dot.d2 {
  right: -1px;
  top: 20px;
}

.loading-dot.d3 {
  left: 20px;
  bottom: -3px;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

@keyframes sunPulse {
  0%,
  100% {
    transform: scale(1);
  }
  50% {
    transform: scale(1.08);
  }
}

.loading-text {
  font-size: 0.96rem;
  color: #0f172a;
  font-weight: 600;
  margin: 0;
}

.loading-subtext {
  margin: 0;
  font-size: 0.82rem;
  color: #475569;
  text-align: center;
}

/* Error */
.error-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  margin: 60px auto;
  max-width: 400px;
}

.state-illustration {
  width: min(320px, 84vw);
  height: auto;
  border-radius: 12px;
  border: 1px solid #fecaca;
}

.error-message {
  font-size: 0.96rem;
  color: #991b1b;
  text-align: center;
}

/* Data Container */
.data-container {
  max-width: min(1320px, 100%);
  width: 100%;
  margin: 0 auto;
  padding-inline: var(--page-pad);
  box-sizing: border-box;
  display: grid;
  grid-template-columns: 1fr;
  gap: 0;
  padding: 0 0 16px;
  border-top: 0;
  margin-top: 0;
  animation: fadeInUp var(--motion-medium) var(--ease-emphasis);
}

.section-block {
  scroll-margin-top: 74px;
  position: relative;
  min-width: 0;
}

.personal-path {
  border: 0;
  border-radius: 0;
  background: transparent;
  padding: 0;
}

.skin-flow-card {
  padding: 0;
  border: 0;
  border-radius: 0;
  background: transparent;
  box-shadow: none;
}

.path-top-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 10px;
}

.path-skin-slot,
.path-absorption-slot {
  min-width: 0;
}

.rail-kicker {
  margin: 0 0 5px;
  font-size: 0.66rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: #64748b;
  font-weight: 700;
}

.rail-title {
  margin: 0 0 6px;
  font-size: 1.04rem;
  color: #0f172a;
  font-weight: 800;
  letter-spacing: -0.01em;
}

.rail-list {
  margin: 0 0 10px;
  padding-left: 18px;
  display: grid;
  gap: 5px;
  color: #475569;
  font-size: 0.76rem;
  font-weight: 600;
}

.path-absorption-slot {
  min-height: 220px;
}

.path-advice-slot {
  margin-top: 10px;
}

#status-section {
  padding: 0 0 24px;
  text-align: center;
  border-bottom: 1px solid rgba(0, 0, 0, 0.07);
  margin-bottom: 40px;
}

#tips-section {
  padding: 0 0 32px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.07);
  margin-bottom: 40px;
}

#skin-section {
  padding: 32px 0;
  border-bottom: 1px solid rgba(0, 0, 0, 0.07);
  margin-bottom: 40px;
}

#advice-section {
  padding: 0 0 40px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.07);
  margin-bottom: 40px;
}

#myths-section {
  padding: 0;
}

.slot-placeholder {
  margin: 0;
  display: flex;
  align-items: center;
  min-height: inherit;
  border-radius: 8px;
  border: none;
  border-left: 3px solid rgba(100, 116, 139, 0.4);
  background: rgba(255, 255, 255, 0.5);
  color: #64748b;
  font-size: 0.82rem;
  font-weight: 600;
  line-height: 1.5;
  text-align: left;
  padding: 10px 12px;
}

.path-absorption-slot.empty {
  min-height: 220px;
}

:deep(.status-box),
:deep(.timeline-card:not(.is-bare)),
:deep(.absorption-card),
:deep(.skin-advice-card),
:deep(.myths-section) {
  border-radius: 0 !important;
  background: transparent !important;
  border: none !important;
  box-shadow: none !important;
  position: relative;
  overflow: visible;
}

:deep(.myths-section) {
  border-radius: 12px !important;
  background: rgba(255, 255, 255, 0.82) !important;
  border: 1px solid rgba(255, 255, 255, 0.9) !important;
  box-shadow: 0 2px 8px rgba(15, 23, 42, 0.04) !important;
  padding: 18px !important;
}

:deep(.skin-selector-section) {
  padding: 14px;
  border-radius: 12px !important;
  background: rgba(255, 255, 255, 0.82) !important;
  border: 1px solid rgba(0, 0, 0, 0.07) !important;
  box-shadow: 0 4px 12px rgba(15, 23, 42, 0.06);
}

.path-skin-slot,
.path-absorption-slot {
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.82);
  border: 1px solid rgba(0, 0, 0, 0.07);
  padding: 12px;
}

:deep(.absorption-card) {
  background: transparent !important;
  border: 0 !important;
  box-shadow: none !important;
  padding: 0 !important;
}

:deep(.advice-item),
:deep(.myth-item) {
  background: transparent !important;
  border: none !important;
  border-left: 3px solid rgba(var(--accent-rgb, 22, 163, 74), 0.4) !important;
  border-radius: 0 !important;
  box-shadow: none !important;
}

:deep(.tips-list) {
  gap: 12px !important;
}

:deep(.advice-items) {
  gap: 12px !important;
}

:deep(.advice-item) {
  padding: 10px 0 10px 14px !important;
}

:deep(.myths-list .myth-item) {
  padding: 12px !important;
  border-left: none !important;
  border-bottom: 0 !important;
  border-radius: 12px !important;
  background: rgba(248, 251, 255, 0.96) !important;
  border: 1px solid rgba(229, 237, 247, 0.95) !important;
}

:deep(.myths-list .myth-item:last-child) {
  border-bottom: none !important;
}

:deep(.myth-visual) {
  background: rgba(255, 255, 255, 0.72) !important;
  border: none !important;
  border-left: 3px solid rgba(59, 130, 246, 0.42) !important;
  border-radius: 8px !important;
}

:deep(.myth-head) {
  align-items: center;
}

:deep(.section-title) {
  font-size: 18px !important;
  font-weight: 600 !important;
  letter-spacing: 0 !important;
}

/* Raise contrast of key reading content across cards */
:deep(.section-title) {
  display: block;
  margin: 0;
  color: #0f172a !important;
}

:deep(.timeline-title) {
  font-size: clamp(1.02rem, 1.05vw, 1.22rem) !important;
  font-weight: 800 !important;
  letter-spacing: -0.01em;
}

:deep(.tips-visual-rail) {
  display: none !important;
}

:deep(.skin-advice-card) {
  padding: 0 !important;
}

:deep(.skin-description) {
  font-style: italic;
}

:deep(.section-subtitle),
:deep(.subtitle),
:deep(.skin-description),
:deep(.timeline-subtitle),
:deep(.advice-text),
:deep(.tip-text),
:deep(.myth-text),
:deep(.detail-text),
:deep(.status-message),
:deep(.fact-text) {
  color: #1f2937 !important;
  font-size: clamp(0.8rem, 0.78rem + 0.1vw, 0.92rem);
  line-height: 1.58;
  font-weight: 500;
}

:deep(.section-subtitle),
:deep(.timeline-subtitle),
:deep(.skin-description) {
  font-weight: 540;
}

:deep(.section-kicker),
:deep(.meta-label),
:deep(.label-muted),
:deep(.timeline-note),
:deep(.advice-note),
:deep(.myth-source),
:deep(.detail-label) {
  font-size: 0.68rem !important;
  font-weight: 700 !important;
  letter-spacing: 0.07em;
  text-transform: uppercase;
  color: #64748b !important;
}

:deep(.advice-label),
:deep(.detail-label),
:deep(.advice-title) {
  color: #334155 !important;
}

:deep(.gauge-center-value) {
  font-size: clamp(34px, 4.2vw, 52px);
  font-weight: 800;
  fill: #101827;
}

.dashboard-row.live :deep(.gauge-section) {
  padding: 0 4px 8px;
  min-height: 0;
  display: grid;
  place-items: center;
  align-self: start;
}

.dashboard-row.live :deep(.gauge-svg) {
  max-width: 100%;
  margin-top: -2px;
  margin-bottom: 0;
}

.dashboard-row.live :deep(.gauge-marker-text) {
  font-size: 8px;
}

.dashboard-row.live :deep(.center-core) {
  transform: scale(1);
}

#status-section :deep(.status-level-badge) {
  transform: scale(1.02);
  font-weight: 800;
}

@keyframes fadeInUp {
  from {
    opacity: 0;
    transform: translateY(12px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* Buttons */
.btn {
  padding: 12px 24px;
  font-size: 0.95rem;
  font-weight: 600;
  border: none;
  border-radius: 14px;
  cursor: pointer;
  transition: all var(--motion-fast) var(--ease-emphasis);
  font-family: inherit;
}

.btn-primary {
  width: 100%;
  background: linear-gradient(
    160deg,
    rgba(var(--cta-rgb, 22, 101, 52), 0.22),
    rgba(255, 255, 255, 0.68)
  );
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  border: 1px solid rgba(255, 255, 255, 0.78);
  color: #0f172a;
  font-weight: 800;
  box-shadow:
    0 8px 20px rgba(15, 23, 42, 0.1),
    inset 0 1px 0 rgba(255, 255, 255, 0.8);
}

.btn-primary:hover {
  background: linear-gradient(
    160deg,
    rgba(var(--cta-rgb, 22, 101, 52), 0.3),
    rgba(255, 255, 255, 0.74)
  );
  transform: translateY(-2px);
  box-shadow:
    0 12px 24px rgba(15, 23, 42, 0.14),
    inset 0 1px 0 rgba(255, 255, 255, 0.88);
}

.btn-primary:active {
  transform: translateY(0);
}

.btn-secondary {
  background: rgba(255, 255, 255, 0.5);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  border: 1.5px solid rgba(255, 255, 255, 0.6);
  color: #166534;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.06);
}

.btn-secondary:hover {
  background: rgba(22, 101, 52, 0.1);
  border-color: rgba(249, 115, 22, 0.4);
}

:deep(.action-inline),
:deep(.advice-title),
:deep(.tip-text strong),
:deep(.advice-text strong) {
  color: #7c2d12 !important;
  font-weight: 800 !important;
}

:deep(.action-inline) {
  margin-top: 6px;
  padding: 6px 8px;
  border-radius: 8px;
  background: linear-gradient(135deg, rgba(254, 215, 170, 0.5), rgba(254, 240, 138, 0.45));
  border: 1px solid rgba(251, 146, 60, 0.28);
}

/* Refresh Row */
.refresh-row {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}

.trust-source {
  grid-column: 1 / -1;
  display: flex;
  align-items: center;
  gap: 6px;
  color: #334155;
  font-size: 0.8rem;
  line-height: 1.4;
  padding: 8px 2px 0;
}

.time-ago {
  font-size: 0.68rem;
  color: rgba(71, 85, 105, 0.7);
  font-weight: 500;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

/* Decorative Clouds */
.deco-clouds {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  pointer-events: none;
  z-index: 0;
  overflow: hidden;
}

.deco-aurora {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 0;
}

.deco-glow {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 0;
}

.glow {
  position: absolute;
  border-radius: 999px;
  filter: blur(52px);
  opacity: 0.22;
}

.glow.g1 {
  width: min(56vw, 680px);
  height: 260px;
  top: 180px;
  left: -130px;
  background: radial-gradient(circle at center, rgba(253, 186, 116, 0.34), rgba(253, 186, 116, 0));
}

.glow.g2 {
  width: min(52vw, 620px);
  height: 240px;
  top: 320px;
  right: -120px;
  background: radial-gradient(circle at center, rgba(74, 222, 128, 0.3), rgba(74, 222, 128, 0));
}

.glow.g3 {
  width: min(44vw, 520px);
  height: 220px;
  top: 56%;
  left: 32%;
  background: radial-gradient(circle at center, rgba(59, 130, 246, 0.16), rgba(59, 130, 246, 0));
}

.aurora {
  position: absolute;
  border-radius: 999px;
  filter: blur(42px);
  opacity: 0.32;
}

.aurora.a1 {
  width: min(46vw, 540px);
  height: 200px;
  top: 120px;
  left: -90px;
  background: radial-gradient(circle at center, rgba(56, 189, 248, 0.35), rgba(56, 189, 248, 0));
  animation: driftAurora calc(var(--motion-slow) * 14) ease-in-out infinite;
}

.aurora.a2 {
  width: min(42vw, 500px);
  height: 220px;
  top: 340px;
  right: -120px;
  background: radial-gradient(circle at center, rgba(16, 185, 129, 0.28), rgba(16, 185, 129, 0));
  animation: driftAurora calc(var(--motion-slow) * 17) ease-in-out infinite reverse;
}

.aurora.a3 {
  width: min(50vw, 620px);
  height: 240px;
  top: 40%;
  left: 20%;
  background: radial-gradient(circle at center, rgba(245, 158, 11, 0.18), rgba(245, 158, 11, 0));
  animation: driftAurora calc(var(--motion-slow) * 20) ease-in-out infinite;
}

@keyframes driftAurora {
  0%,
  100% {
    transform: translateX(0) translateY(0);
  }
  50% {
    transform: translateX(24px) translateY(-14px);
  }
}

.cloud {
  position: absolute;
  background: rgba(255, 255, 255, 0.4);
  border-radius: 100px;
  filter: blur(35px);
}

.cloud-1 {
  width: 240px;
  height: 70px;
  top: 5%;
  left: -50px;
  animation: driftCloud calc(var(--motion-slow) * 20) ease-in-out infinite;
}

.cloud-2 {
  width: 180px;
  height: 55px;
  top: 20%;
  right: -30px;
  opacity: 0.6;
  animation: driftCloud calc(var(--motion-slow) * 25) ease-in-out infinite reverse;
}

.cloud-3 {
  width: 150px;
  height: 50px;
  bottom: 25%;
  left: 10%;
  opacity: 0.45;
  animation: driftCloud calc(var(--motion-slow) * 28) ease-in-out infinite 2s;
}

@keyframes driftCloud {
  0%,
  100% {
    transform: translateX(0) translateY(0);
  }
  50% {
    transform: translateX(40px) translateY(-8px);
  }
}

/* Responsive */
@media (max-width: 480px) {
  .uv-tracker-root {
    padding-top: 62px;
  }

  .content-section {
    padding: 4px 6px 136px;
  }

  .dashboard-row,
  .location-strip,
  .data-container {
    width: 100%;
    max-width: 100%;
  }

  .dashboard-row.live {
    grid-template-columns: minmax(0, 1.18fr) minmax(0, 0.82fr);
    align-items: stretch;
    gap: 8px;
  }

  .timeline-inline {
    min-height: 184px;
    padding: 0 0 0 10px;
  }

  .timeline-inline :deep(.timeline-card.is-bare .timeline-head) {
    margin-bottom: 6px;
  }

  .timeline-inline :deep(.timeline-card.is-bare .chart-wrap) {
    min-height: 126px;
  }

  .dashboard-row.live :deep(.center-core) {
    transform: scale(1.07);
  }

  .dashboard-row.live :deep(.gauge-section) {
    padding: 0 0 2px;
  }

  .dashboard-row.live :deep(.gauge-svg) {
    max-width: 112%;
  }
}

@media (max-width: 600px) {
  .uv-tracker-root {
    --page-pad: 12px;
  }
}

@media (min-width: 980px) {
  .uv-tracker-root {
    --page-pad: 48px;
  }

  .dashboard-row.live {
    grid-template-columns: 1fr 1fr;
    align-items: center;
    gap: 10px;
  }

  .timeline-inline {
    min-height: 312px;
    padding: 10px 12px;
  }

  .dashboard-row.live :deep(.gauge-svg) {
    max-width: 100%;
  }

  .dashboard-row.live :deep(.center-core) {
    transform: scale(1);
  }

  .data-container {
    grid-template-columns: repeat(12, minmax(0, 1fr));
    gap: 8px;
    align-items: start;
    align-content: start;
    grid-auto-flow: row dense;
  }

  #status-section {
    grid-column: 1 / -1;
  }

  #tips-section,
  #skin-section,
  #advice-section,
  #myths-section {
    grid-column: 1 / -1;
  }

  #myths-section {
    grid-column: 1 / -1;
  }

  .refresh-row {
    grid-column: 1 / -1;
  }

  .path-top-grid {
    grid-template-columns: 1fr 1fr;
    gap: 12px;
    align-items: start;
  }

  .path-absorption-slot {
    min-height: 100%;
  }
}

@media (max-width: 360px) {
  .content-section {
    padding: 2px 6px 164px;
  }

  .data-container {
    max-width: 100%;
    gap: 7px;
  }

  .trust-source {
    font-size: 0.72rem;
    line-height: 1.35;
    padding-top: 6px;
  }

  .btn-primary {
    font-size: 0.88rem;
    padding: 11px 12px;
  }

  .subtitle {
    font-size: 0.7rem;
  }

  .dashboard-row,
  .location-strip {
    width: 100%;
    max-width: 100%;
    padding-inline: 6px;
  }

  .timeline-inline {
    min-height: 172px;
    padding: 0 0 0 8px;
  }

  .dashboard-row.live {
    grid-template-columns: minmax(0, 1.2fr) minmax(0, 0.8fr);
    gap: 4px;
  }

  .dashboard-row.live :deep(.gauge-svg) {
    max-width: 116%;
  }
}

@media (max-width: 375px) {
  .top-banner {
    padding: 8px 12px 6px;
  }

  .banner-title {
    font-size: 0.94rem;
  }

  .banner-tagline {
    font-size: 0.69rem;
  }

  .header-section {
    padding: 2px 10px 8px;
  }

  .subtitle {
    font-size: 0.72rem;
    line-height: 1.42;
  }

  .permission-note {
    font-size: 0.68rem;
    padding: 3px 6px;
  }
}

#skin-cancer-impact-section {
  grid-column: 1 / -1;
  width: 100%;
  min-width: 0;
  padding: 0 0 32px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.07);
  margin-bottom: 40px;
}

#trend-section {
  grid-column: 1 / -1;
  padding: 0 0 32px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.07);
  margin-bottom: 40px;
}
</style>
