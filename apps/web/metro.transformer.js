const upstreamTransformer = require('@expo/metro-config/babel-transformer');

module.exports.transform = async (props) => {
  // Replace import.meta references before transformation
  if (props.src.includes('import.meta')) {
    props.src = props.src
      // Handle import.meta.env.MODE
      .replace(/import\.meta\.env\s*\?\s*import\.meta\.env\.MODE\s*:\s*void\s*0/g, '"development"')
      // Handle import.meta.env
      .replace(/import\.meta\.env/g, 'process.env')
      // Handle import.meta.url
      .replace(/import\.meta\.url/g, '"http://localhost"')
      // Handle generic import.meta
      .replace(/import\.meta/g, '({env: process.env, url: "http://localhost"})');
  }

  return upstreamTransformer.transform(props);
};