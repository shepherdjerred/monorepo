<template>
    <progress class="counter-progress progress"
             :value="currentValue"
             :max="maxValue">
    </progress>
</template>

<script>
  export default {
    name: 'counter-progress',
    props: {
      currentValue: {
        required: true,
        type: Number
      },
      maxValue: {
        require: true,
        type: Number
      }
    }
  };
</script>

<style scoped lang="scss">
    .counter-progress {
        width: 15vw;
        margin-top: 40px;
    }

    @media screen and (max-width: 768px) {
        .counter-progress {
            width: 50vw;
        }
    }
</style>
