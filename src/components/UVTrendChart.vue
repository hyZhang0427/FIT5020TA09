<script setup>
import { ref, onMounted, onUnmounted, nextTick } from 'vue'
import {
  Chart,
  LineController,
  LineElement,
  PointElement,
  LinearScale,
  CategoryScale,
  Tooltip,
  Filler,
  Legend,
} from 'chart.js'

Chart.register(
  LineController,
  LineElement,
  PointElement,
  LinearScale,
  CategoryScale,
  Tooltip,
  Filler,
  Legend,
)

const canvasRef = ref(null)
const loading = ref(true)
const error = ref('')
const trendData = ref([])

let chartInstance = null

function destroyChart() {
  if (chartInstance) {
    chartInstance.destroy()
    chartInstance = null
  }
}

function buildChart() {
  if (!canvasRef.value || !trendData.value.length) return

  destroyChart()

  const labels = trendData.value.map(
    (d) => `${d.year}-${String(d.month).padStart(2, '0')}`
  )
  const uvData = trendData.value.map((d) => d.uv)
  const heatData = trendData.value.map((d) => d.heat)

  const peakIndices = trendData.value
    .map((d, i) => (d.isPeakUv ? i : null))
    .filter((i) => i !== null)

  const ctx = canvasRef.value.getContext('2d')

  chartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'UV Index',
          data: uvData,
          borderColor: '#E53210',
          backgroundColor: 'rgba(229,50,16,0.08)',
          yAxisID: 'y',
          tension: 0.3,
          fill: false,
          pointBackgroundColor: labels.map((_, i) =>
            peakIndices.includes(i) ? '#FFD600' : '#E53210'
          ),
          pointBorderColor: labels.map((_, i) =>
            peakIndices.includes(i) ? '#B58900' : '#E53210'
          ),
          pointRadius: labels.map((_, i) => (peakIndices.includes(i) ? 4 : 1)),
          pointHoverRadius: labels.map((_, i) => (peakIndices.includes(i) ? 8 : 5)),
          borderWidth: 2.5,
        },
        {
          label: 'Heat Index',
          data: heatData,
          borderColor: '#0077B6',
          backgroundColor: 'rgba(0,119,182,0.08)',
          yAxisID: 'y1',
          tension: 0.3,
          fill: false,
          pointRadius: 1,
          pointHoverRadius: 5,
          spanGaps: true,
          borderWidth: 2.5,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: 'index',
        intersect: false,
      },
      plugins: {
        legend: {
          display: true,
          position: 'top',
          labels: {
            usePointStyle: true,
            boxWidth: 10,
            color: '#0f172a',
            font: {
              size: 12,
              weight: '600',
            },
          },
        },
        tooltip: {
          enabled: true,
          backgroundColor: 'rgba(15, 23, 42, 0.94)',
          titleColor: '#ffffff',
          bodyColor: '#e5e7eb',
          padding: 12,
        },
      },
      scales: {
        x: {
          grid: {
            color: 'rgba(148, 163, 184, 0.14)',
          },
          ticks: {
            color: '#475569',
            maxTicksLimit: 10,
          },
          title: {
            display: true,
            text: 'Month',
            color: '#334155',
            font: {
              size: 12,
              weight: '700',
            },
          },
        },
        y: {
          type: 'linear',
          position: 'left',
          title: {
            display: true,
            text: 'UV Index',
            color: '#334155',
            font: {
              size: 12,
              weight: '700',
            },
          },
          min: 0,
          max: 12,
          grid: {
            color: 'rgba(148, 163, 184, 0.18)',
          },
          ticks: {
            color: '#475569',
          },
        },
        y1: {
          type: 'linear',
          position: 'right',
          title: {
            display: true,
            text: 'Heat Index (°C)',
            color: '#334155',
            font: {
              size: 12,
              weight: '700',
            },
          },
          min: 0,
          max: 50,
          grid: {
            drawOnChartArea: false,
          },
          ticks: {
            color: '#475569',
          },
        },
      },
    },
  })
}

async function fetchTrendData() {
  try {
    loading.value = true
    error.value = ''

    const response = await fetch('http://localhost:3001/api/uv-trends')
    if (!response.ok) {
      throw new Error(`Failed to fetch UV trends (${response.status})`)
    }

    const data = await response.json()
    trendData.value = Array.isArray(data) ? data : []

    if (!trendData.value.length) {
      throw new Error('No UV trend data available')
    }

    loading.value = false
    await nextTick()

    buildChart()
  } catch (err) {
    error.value =
      err instanceof Error ? err.message : 'Failed to load UV trend data'
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  fetchTrendData()
})

onUnmounted(() => {
  destroyChart()
})
</script>

<template>
  <section class="dashboard-card uv-chart-card reveal">
    <div class="card-header">
      <p class="card-kicker">UV Trend</p>
      <h2 class="card-title">Melbourne UV Intensity and Heat Index Trends</h2>
      <p class="card-subtitle">
        View monthly UV intensity and heat index changes over the past 5 years.
        Yellow-highlighted points mark peak UV periods.
      </p>
    </div>

    <div v-if="loading" class="chart-state">Loading chart data...</div>
    <div v-else-if="error" class="chart-state error">{{ error }}</div>
    <div v-else class="chart-wrap">
      <canvas ref="canvasRef"></canvas>
    </div>
    <p v-if="!loading && !error" class="card-explanation">
      <strong>Heat and UV rise together, which can make people stay outside longer and underestimate damage.</strong>
    </p>
    <p v-if="!loading && !error" class="card-note">
      Highlighted points: <strong>Peak UV periods</strong> for each year.
    </p>
  </section>
</template>

<style scoped>
.card-explanation {
  font-size: 1.5rem;
  color: #334155;
  margin-top: 12px;
  font-weight: 600;
}

@media (max-width: 640px) {
  .chart-card {
    padding: 14px;
  }

  .chart-wrap,
  .chart-state {
    height: 300px;
    min-height: 300px;
  }

  .chart-subtitle {
    font-size: 0.86rem;
  }

  .chart-note {
    font-size: 0.8rem;
  }

  .card-explanation {
    font-size: 1rem;
  }
}
</style>