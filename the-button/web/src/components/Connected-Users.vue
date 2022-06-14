<template>
    <div>
        <div class="connectedUsersPhrase">{{ connectedUsersPhrase }}</div>
    </div>
</template>

<script>
  export default {
    name: 'connected-users',
    props: {
      connectedUsers: {
        required: true,
        type: Number
      },
      userNounSingular: {
        required: true,
        type: String
      },
      userNounPlural: {
        required: true,
        type: String
      }
    },
    computed: {
      connectedUsersPhrase: function () {
        if (this.connectedUsers < 2) {
          return 'There are no other ' + this.userNounPlural + ' here now';
        } else if (this.connectedUsers === 2) {
          return 'There is ' + (this.connectedUsers - 1) + ' other ' + this.userNounSingular + ' here now';
        } else {
          return 'There are ' + (this.connectedUsers - 1) + ' other ' + this.userNounPlural + ' here now';
        }
      }
    }
  };
</script>

<style scoped lang="scss">
    .connectedUsersPhrase {
        padding-top: 20px;
    }
</style>
