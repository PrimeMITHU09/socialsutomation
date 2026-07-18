// Store configuration — set your website URL in Settings
const storeConfig = {
  websiteUrl: '',
  websiteName: 'My Store',
  websiteDesc: 'Browse our premium digital products and automation tools.',
  products: []
};

const projects = [];

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { projects, storeConfig };
} else if (typeof window !== 'undefined') {
  window.projectsData = projects;
  window.storeConfig = storeConfig;
}
