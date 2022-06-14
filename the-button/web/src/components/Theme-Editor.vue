<template>
    <div>
        <div class="field">
            <label class="label">Icon</label>
            <div class="control has-icons-left">
                <input class="input"
                       type="text"
                       placeholder="Icon"
                       v-model="icon">
                <span class="icon is-small is-left">
                    <i class="fa"
                       v-bind:class="icon"></i>
                </span>
            </div>
        </div>
        <div class="field">
            <label class="label">Icon color</label>
            <div class="control has-icons-left">
                <input class="input"
                       type="text"
                       placeholder="Icon color"
                       v-model="iconColor">
                <span class="icon is-small is-left">
                    <i class="fa fa-square"
                       v-bind:style="{ color: iconColor }"></i>
                </span>
            </div>
        </div>
        <div class="field">
            <label class="label">Primary color</label>
            <div class="control has-icons-left">
                <input class="input"
                       type="text"
                       placeholder="Primary color"
                       v-model="primaryColor">
                <span class="icon is-small is-left">
                    <i class="fa fa-square"
                       v-bind:style="{ color: primaryColor }"></i>
                </span>
            </div>
        </div>
    </div>
</template>

<script>
  export default {
    name: "theme-editor",
    computed: {
      icon: {
        get: function () {
          return this.$store.state.Theme.activeTheme.icon;
        },
        set: function (newIcon) {
          this.$store.commit('setIcon', newIcon);
        }
      },
      iconColor: {
        get: function () {
          return this.$store.state.Theme.activeTheme.iconColor;
        },
        set: function (newIconColor) {
          this.$store.commit('setIconColor', newIconColor);
        }
      },
      primaryColor: {
        get: function () {
          return this.$store.state.Theme.activeTheme.primaryColor;
        },
        set: function (newPrimaryColor) {
          this.$store.commit('setPrimaryColor', newPrimaryColor);
        }
      }
    }
  }
</script>

<style scoped lang="scss">

</style>
