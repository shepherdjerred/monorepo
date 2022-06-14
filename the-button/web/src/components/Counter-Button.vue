<template>
    <div>
        <div class="counter-button"
             v-bind:style="{ background: background, boxShadow: boxShadow }"
             @mouseenter="setHovered(true)"
             @mouseleave="setHovered(false)"
             @mousedown="setActive(true)"
             @mouseup="setActive(false)"
             @click="click">
            <template v-if="icon !== ''">
                <i class="counter-button-icon fa" v-bind:class="icon" v-bind:style="{ color: iconColor }"></i>
            </template>
        </div>
    </div>
</template>

<script>
  export default {
    name: "counter-button",
    props: {
      icon: {
        type: String,
        required: false,
        default: ''
      },
      iconColor: {
        type: String,
        required: false,
        default: ''
      },
      inactiveBackground: {
        type: String,
        required: true
      },
      hoverBackground: {
        type: String,
        required: true
      },
      activeBackground: {
        type: String,
        required: true
      },
      boxShadow: {
        type: String,
        required: true
      }
    },
    computed: {
      background() {
        if (this.isHovered) {
          if (this.isActive) {
            return this.activeBackground;
          } else {
            return this.hoverBackground;
          }
        } else {
          return this.inactiveBackground;
        }
      }
    },
    data() {
      return {
        isHovered: false,
        isActive: false
      }
    },
    methods: {
      setHovered(isHovered) {
        this.isHovered = isHovered;
      },
      setActive(isActive) {
        this.isActive = isActive;
      },
      click() {
        this.$emit('click');
      }
    }
  }
</script>

<style scoped lang="scss">
    .counter-button {
        border-radius: 100%;
        height: 15vw;
        width: 15vw;
        display: flex;
        align-items: center;
        justify-content: center;
    }

    .counter-button-icon {
        font-size: 5vw;
    }

    @media screen and (max-width: 768px) {
        .counter-button {
            height: 50vw;
            width: 50vw;
        }

        .counter-button-icon {
            font-size: 15vw;
        }
    }
</style>
