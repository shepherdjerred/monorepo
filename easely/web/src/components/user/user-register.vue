<template>
  <div>
    <div class="container">
      <div class="columns">
        <div class="column is-one-third is-offset-one-third">
          <div class="notification is-primary">
            Please
            <router-link :to="{ name: 'About'}" class="alert-link">read about Easely</router-link>
            before registering
          </div>
          <div class="box loginMenu">
            <h3 class="title is-3">Register on Easely</h3>
            <template v-if="registerError">
              <div class="notification is-danger">
                An error occurred while registering
              </div>
            </template>

            <form v-on:submit.prevent="onSubmit">

              <div class="field">
                <label class="label" for="email">Email address</label>
                <div class="control">
                  <input class="input" type="email" id="email" v-model="email" required>
                </div>
                <template v-if="isEmailInvalid">
                  <p>You must register with your Harding email address</p>
                </template>
              </div>

              <div class="field">
                <label class="label" for="password">Password</label>
                <div class="control">
                  <input class="input" type="password" id="password" v-model="password" required>
                </div>
                <template v-if="isPasswordInvalid">
                  <p>Your password must be a least 8 characters long</p>
                </template>
              </div>

              <div class="field">
                <label class="label" for="confirmPassword">Confirm Password</label>
                <div class="control">
                  <input class="input" type="password" id="confirmPassword" v-model="confirmPassword" required>
                </div>
                <template v-if="isConfirmPasswordInvalid">
                  <p>Your passwords don't match</p>
                </template>
              </div>

              <hr>
              <div class="field">
                <label class="label" for="easelUsername">EASEL Username</label>
                <div class="control">
                  <input class="input" type="text" id="easelUsername" v-model="easelUsername" required>
                </div>
              </div>

              <div class="field">
                <label class="label" for="easelPassword">EASEL Password</label>
                <div class="control">
                  <input class="input" type="password" id="easelPassword" v-model="easelPassword" required>
                </div>
              </div>

              <p>
                We need your EASEL credentials to load your classes, assignments, and grades from the EASEL website. They are stored in plain text.
              </p>

              <button type="submit" class="button is-primary">Register</button>
            </form>
            <router-link :to="{ name: 'Login' }">
              Already have an account? Login now
            </router-link>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
  export default {
    name: 'User-Register',
    data: function () {
      return {
        email: '',
        password: '',
        confirmPassword: '',
        easelUsername: '',
        easelPassword: '',
        registerError: false
      };
    },
    computed: {
      isEmailInvalid: function () {
        // https://stackoverflow.com/questions/3270185/javascript-regex-to-determine-the-emails-domain-yahoo-com-for-example
        return /(@)/.test(this.email) && !/@harding.edu\s*$/.test(this.email.toLowerCase());
      },
      isPasswordInvalid: function () {
        return this.password.length < 8 && this.password.length > 0;
      },
      isConfirmPasswordInvalid: function () {
        return this.password !== this.confirmPassword && this.confirmPassword.length > 0
      }
    },
    methods: {
      onSubmit: function () {
        if (this.password !== this.confirmPassword) {
          return;
        }
        this.$http.post(process.env.API_URL + '/api/user/register', {
          'email': this.email,
          'password': this.password,
          'easelUsername': this.easelUsername,
          'easelPassword': this.easelPassword
        }).then(response => {
          console.log(response.body);
          localStorage.setItem('jwt', response.body.jsonWebToken);
          this.$store.dispatch('updateUser');
          this.$router.push({name: 'Home'});
        }, response => {
          console.log(response.body);
          this.registerError = true;
        });
      }
    }
  };
</script>

<style lang="scss" scoped>
  .registerMenu {
    margin-top: 30px;
  }

  .registerCard {
    margin-bottom: 10px;
  }
</style>
