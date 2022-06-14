const state = {
  open: false,
  reward: undefined,
  rewards: {
    puppy: {
      display: 'Puppy',
      type: 'image',
      urls: [
        'http://theprojectheal.org/wp-content/uploads/2016/01/Aaaaaawwwwwwwwww-Sweet-puppies-9415255-1600-1200.jpg',
        'https://timedotcom.files.wordpress.com/2017/11/puppies-puerto-rico.jpeg?quality=85',
        'https://www.cesarsway.com/sites/newcesarsway/files/styles/large_article_preview/public/All-about-puppies--Cesar%E2%80%99s-tips%2C-tricks-and-advice.jpg?itok=bi9xUvwe',
        'https://assets1.cdn-mw.com/mw/images/article/art-wap-landing-mp-lg/puppy-3143-ad4140d8f6055cda2cd8956d4af37ea9@1x.jpg'
      ]
    },
    kitty: {
      display: 'Kitty',
      type: 'image',
      urls: [
        'https://static1.squarespace.com/static/54e8ba93e4b07c3f655b452e/t/56c2a04520c64707756f4267/1493764650017/',
        'https://www.petful.com/wp-content/uploads/2016/01/we-love-kittens-and-cats.jpg',
        'http://kittenrescue.org/wp-content/uploads/2017/03/KittenRescue_KittenCareHandbook.jpg'
      ]
    },
    theme: {
      display: 'Theme',
      type: 'theme'
    }
  }
};

const mutations = {
  setOpen (state, value) {
    state.open = value;
    if (value === false) {
      state.reward = undefined;
    }
  },
  SOCKET_REWARD (context, reward) {
    context.reward = reward;
    context.open = true;
  }
};

const getters = {
  getProcessedReward: (state) => {
    let processedReward;
    if (state.reward !== undefined) {
      processedReward = Object.assign({}, state.rewards[state.reward]);
      if (processedReward.urls) {
        processedReward.url = processedReward.urls[Math.floor(Math.random() * processedReward.urls.length)];
      }
    }
    return processedReward;
  }
};

export default {
  state,
  mutations,
  getters
};
