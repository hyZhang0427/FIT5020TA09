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
  Legend,
} from 'chart.js'

Chart.register(
  LineController,
  LineElement,
  PointElement,
  LinearScale,
  CategoryScale,
  Tooltip,
  Legend,
)

const canvasRef = ref(null)
const loading = ref(true)
const error = ref('')
const riskData = ref([])

let chartInstance = null

function destroyChart() {
  if (chartInstance) {
    chartInstance.destroy()
    chartInstance = null
  }
}

function buildChart() {
  if (!canvasRef.value || !riskData.value.length) return

  destroyChart()

  const labels = riskData.value.map((d) => d.year)
  const age30Data = riskData.value.map((d) => Number(d.age30))
  const age60Data = riskData.value.map((d) => Number(d.age60))
  const lifetimeData = riskData.value.map((d) => Number(d.lifetime))

  const ctx = canvasRef.value.getContext('2d')

  chartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Risk by Age 30',
          data: age30Data,
          borderColor: '#FACC15',
          backgroundColor: '#FACC15',
          pointBackgroundColor: '#FACC15',
          pointBorderColor: '#CA8A04',
          pointHoverBackgroundColor: '#FACC15',
          pointHoverBorderColor: '#CA8A04',
          borderWidth: 4,
          pointRadius: 0.5,
          pointHoverRadius: 7,
          tension: 0.35,
          fill: false,
          order: 1,
        },
        {
          label: 'Risk by Age 60',
          data: age60Data,
          borderColor: '#0284C7',
          backgroundColor: '#0284C7',
          pointBackgroundColor: '#0284C7',
          pointBorderColor: '#0369A1',
          pointHoverBackgroundColor: '#0284C7',
          pointHoverBorderColor: '#0369A1',
          borderWidth: 2.5,
          pointRadius: 0.5,
          pointHoverRadius: 5,
          tension: 0.35,
          fill: false,
          order: 2,
        },
        {
          label: 'Lifetime Risk',
          data: lifetimeData,
          borderColor: '#DC2626',
          backgroundColor: '#DC2626',
          pointBackgroundColor: '#DC2626',
          pointBorderColor: '#B91C1C',
          pointHoverBackgroundColor: '#DC2626',
          pointHoverBorderColor: '#B91C1C',
          borderWidth: 2.5,
          pointRadius: 0.5,
          pointHoverRadius: 5,
          tension: 0.35,
          fill: false,
          order: 3,
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
          callbacks: {
            label(context) {
              return `${context.dataset.label}: ${context.parsed.y.toFixed(3)}%`
            },
          },
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
            text: 'Year',
            color: '#334155',
            font: {
              size: 12,
              weight: '700',
            },
          },
        },
        y: {
          min: 0,
          max: 7,
          grid: {
            color: 'rgba(148, 163, 184, 0.18)',
          },
          ticks: {
            color: '#475569',
            callback(value) {
              return `${value}%`
            },
          },
          title: {
            display: true,
            text: 'Melanoma Diagnosis Risk (%)',
            color: '#334155',
            font: {
              size: 12,
              weight: '700',
            },
          },
        },
      },
    },
  })
}

async function fetchRiskData() {
  try {
    loading.value = true
    error.value = ''
    
    const API_BASE_URL = import.meta.env.VITE_API_BASE_URL
    console.log('API base URL:', import.meta.env.VITE_API_BASE_URL)
    const response = await fetch(`${API_BASE_URL}/api/skin-cancer-stats`)
    if (!response.ok) {
      throw new Error(`Failed to fetch skin cancer stats (${response.status})`)
    }

    const data = await response.json()
    riskData.value = Array.isArray(data) ? data : []

    if (!riskData.value.length) {
      throw new Error('No skin cancer risk data available')
    }
    loading.value = false
    await nextTick()
    buildChart()
  } catch (err) {
    error.value =
      err instanceof Error
        ? err.message
        : 'Failed to load skin cancer risk data'
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  fetchRiskData()
})

onUnmounted(() => {
  destroyChart()
})
</script>

<template>
  <section class="dashboard-card skin-chart-card reveal">
    <div class="card-header">
      <p class="card-kicker">Skin Cancer Impacts</p>
      <h2 class="card-title">Australia Melanoma Diagnosis Risk Over Time</h2>
      <p class="card-subtitle">
        Compare diagnosis risk by age 30, age 60, and lifetime risk. The highlighted
        yellow line emphasises the younger age benchmark.
      </p>
    </div>

    <div v-if="loading" class="chart-state">Loading chart data...</div>
    <div v-else-if="error" class="chart-state error">{{ error }}</div>
    <div v-else class="chart-wrap">
      <canvas ref="canvasRef"></canvas>
    </div>

    <p v-if="!loading && !error" class="card-explanation">
      <strong>You may not feel high risk now, but your future skin health is being shaped by your current habits.</strong>
    </p>

    <p v-if="!loading && !error" class="card-note">
      Highlighted series: Risk by Age 30, used to represent the younger group.
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
    font-size: 0.9rem;
  }
}
</style>