<template>
  <div>
    <section class="hero is-primary">
      <div class="hero-body">
        <div class="container">
          <h1 class="title">
            About
          </h1>
        </div>
      </div>
    </section>
    <div class="container">
      <div class="columns">
        <div class="column is-half is-offset-one-quarter">
          <section class="section">
            <h3 class="is-3 title">What is Easely?</h3>
            <p>
              Easely is an unofficial API and client for accessing the HUCS EASEL website. It was made as a more functional and attractive alternative to the traditional site, with maintaining as much functionality as possible.
            </p>
          </section>

          <section class="section">
            <h3 class="is-3 title">Affiliation</h3>
            <p>
              Easely is not affiliated with Harding University, the Harding University Computer Science department, or DormNet.
            </p>
          </section>

          <section class="section">
            <h3 class="is-3 title">Security</h3>
            <p>
              Easely hashes account passwords with jBCrypt, however EASEL credentials are stored in plain text. You are using this service at your own risk. Please ensure your EASEL password is unique and not used with any other services.
            </p>
            <p>
              While I have no intention to exploit EASEL credentials, it's important to disclose that I, or anyone with access to the database, could.
            </p>
          </section>

          <section class="section">
            <h3 class="is-3 title">Source</h3>
            <p>
              Easely is completely open source. You can view the project on <a
                href="https://github.com/Easely">GitHub</a>
            </p>
          </section>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
  export default {
    name: 'About'
  }
</script>

<style lang="scss" scoped>

</style>
