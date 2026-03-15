<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
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
import { melanomaRiskOverTime } from '../data/skinCancerStats.js'

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
let chartInstance = null

const labels = melanomaRiskOverTime.map((d) => d.year)
const age30Data = melanomaRiskOverTime.map((d) => d.age30)
const age60Data = melanomaRiskOverTime.map((d) => d.age60)
const lifetimeData = melanomaRiskOverTime.map((d) => d.lifetime)

function renderChart() {
  if (!canvasRef.value) return

  if (chartInstance) {
    chartInstance.destroy()
    chartInstance = null
  }

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
          pointRadius: 5,
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
          pointRadius: 3,
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
          pointRadius: 3,
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

onMounted(() => {
  renderChart()
})

onUnmounted(() => {
  if (chartInstance) {
    chartInstance.destroy()
    chartInstance = null
  }
})
</script>

<template>
  <section class="skin-cancer-impact-chart reveal">
    <div class="chart-header">
      <p class="chart-kicker">Skin Cancer Impacts</p>
      <h2 class="chart-title">Australia Melanoma Diagnosis Risk Over Time</h2>
      <p class="chart-subtitle">
        Compare diagnosis risk by age 30, age 60, and lifetime risk. The highlighted
        yellow line emphasises the younger age benchmark.
      </p>
    </div>

    <div class="chart-wrap">
      <canvas ref="canvasRef"></canvas>
    </div>

    <p class="chart-note">
      Highlighted series: <strong>Risk by Age 30</strong>, used to represent the younger group.
    </p>
  </section>
</template>

<style scoped>
.skin-cancer-impact-chart {
  width: min(100%, 980px);
  margin: 0 auto 24px;
  padding: 18px;
  border-radius: 14px;
  background: rgba(255, 253, 250, 0.92);
  box-shadow: 0 4px 18px rgba(15, 23, 42, 0.08);
  box-sizing: border-box;
}

.chart-header {
  margin-bottom: 14px;
}

.chart-kicker {
  margin: 0 0 6px;
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: #64748b;
  font-weight: 700;
}

.chart-title {
  margin: 0 0 8px;
  font-size: clamp(1.05rem, 1.4vw, 1.35rem);
  line-height: 1.25;
  color: #0f172a;
  font-weight: 800;
}

.chart-subtitle {
  margin: 0;
  font-size: 0.92rem;
  line-height: 1.55;
  color: #334155;
}

.chart-wrap {
  position: relative;
  width: 100%;
  height: 340px;
}

.chart-note {
  margin: 10px 0 0;
  font-size: 0.84rem;
  line-height: 1.45;
  color: #854d0e;
  font-weight: 600;
}

@media (max-width: 640px) {
  .skin-cancer-impact-chart {
    padding: 14px;
  }

  .chart-wrap {
    height: 300px;
  }

  .chart-subtitle {
    font-size: 0.86rem;
  }

  .chart-note {
    font-size: 0.8rem;
  }
}
</style>